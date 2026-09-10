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
import { ApiError } from "../api/client";

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
  createOwnFamily: vi.fn(),
  renameFamily: vi.fn(),
  removeFamilyMember: vi.fn(),
}));

vi.mock("../api/groups", () => ({
  createMyCircle: vi.fn(),
  endLeadership: vi.fn(),
  getGroup: vi.fn(),
  getMyAttendances: vi.fn(),
  updateCircle: vi.fn(),
}));

vi.mock("../api/inventories", () => ({
  createInventory: vi.fn(),
  getInventories: vi.fn(),
  getInventoryItems: vi.fn(),
  registerInventoryItem: vi.fn(),
  updateInventoryItem: vi.fn(),
  deleteInventoryItem: vi.fn(),
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
  updateTerm: vi.fn(),
  updateNeededItem: vi.fn(),
  deleteNeededItem: vi.fn(),
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
  organizer_slug: "ania-kowalska",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

// Organizer/circle whose organizer owns no Organization — the backend still
// returns a stable `k-<hash>` pseudo-slug so per-term links always work.
const mockGroupHashSlug: groupsApi.GroupResponse = {
  ...mockGroup,
  organizer_slug: "k-abc123def456",
};

// per-file clipboard stub (jsdom has no navigator.clipboard) — call history is
// wiped by vi.resetAllMocks() in each beforeEach.
const clipboardWriteText = vi.fn();
Object.assign(navigator, { clipboard: { writeText: clipboardWriteText } });

const mockFamily: familiesApi.FamilyOut = {
  id: 10,
  party_id: 99,
  name: "Kowalscy",
  child_count: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const mockAttendances: groupsApi.MyAttendanceResponse[] = [
  {
    attendance_id: 1,
    term_id: 3,
    occurs_on: "2026-02-15",
    child_count: 2,
    group_id: 5,
    group_name: "Nutki dla starszaków",
    organizer_display_name: "Ania Kowalska",
    organizer_slug: "ania-kowalska",
  },
  {
    attendance_id: 2,
    term_id: 8,
    occurs_on: "2026-03-01",
    child_count: 1,
    group_id: 6,
    group_name: "Rytmika",
    organizer_display_name: "Basia Nowak",
    organizer_slug: "basia-nowak",
  },
];

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
  vi.mocked(groupsApi.getMyAttendances).mockResolvedValue([]);
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
  vi.mocked(groupsApi.getMyAttendances).mockResolvedValue([]);
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

  it('the ORGANIZER-with-zero-terms home hint opens the 1-step FirstTermStepperOrganizer', async () => {
    mockOrganizerDefaults();
    renderPanel();

    // The hamburger item is gone (commented out); the home HintCard is the path.
    fireEvent.click(await screen.findByRole("button", { name: "Dodaj termin →" }));

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
    // A brand-new guest circle has no Organization → the backend returns a
    // stable `k-<hash>` pseudo-slug so the done-screen CTA still deep-links
    // to the just-created term.
    vi.mocked(groupsApi.createMyCircle).mockResolvedValue(mockGroupHashSlug);
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

    const dateInput = await within(dialog).findByLabelText("Data i godzina");
    fireEvent.change(dateInput, { target: { value: "2026-02-01T17:00" } });

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
        occurs_on: "2026-02-01T17:00",
        description: undefined,
      }),
    );

    // Dialog stays open, offering a switch to the public circle page,
    // instead of closing immediately — deep-linked to the created term via
    // the circle's (hash) slug.
    const publicLink = await within(dialog).findByRole("link", {
      name: /Przejdź do publicznej strony/,
    });
    expect(publicLink).toHaveAttribute(
      "href",
      `/${mockGroupHashSlug.organizer_slug}/grupa/${mockGroupHashSlug.id}/term/1`,
    );

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

  it('GUEST sees a "Możesz zostać organizatorem" card that opens the circle-creation flow and dismisses on its own key', async () => {
    mockGuestDefaults();
    renderPanel();

    expect(await screen.findByText("Możesz zostać organizatorem")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Załóż krąg →" }));
    const dialog = await screen.findByRole("dialog", { name: "Dodaj pierwszy termin" });
    // guest 2-step flow — step 1 is the circle-name field (the "add a group" shortcut)
    expect(within(dialog).getByPlaceholderText("np. Nutki dla starszaków")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Zamknij" }));

    fireEvent.click(screen.getByRole("button", { name: "Zamknij: Możesz zostać organizatorem" }));
    expect(screen.queryByText("Możesz zostać organizatorem")).not.toBeInTheDocument();
    expect(localStorage.getItem("hint_become_organizer_dismissed")).toBe("1");
    // the other guest card is independent
    expect(screen.getByText("Dodaj swój pierwszy termin")).toBeInTheDocument();
  });

  it("a GUEST who dismissed the pre-promotion first-term card still sees the organizer first-term card after getting a circle", async () => {
    localStorage.setItem("hint_first_term_dismissed", "1");
    mockOrganizerDefaults(); // organizer-by-circle, zero terms
    renderPanel();

    expect(await screen.findByText("Ustal pierwsze zajęcia w swoim kręgu.")).toBeInTheDocument();
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
    expect(localStorage.getItem("hint_org_first_term_dismissed")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Zamknij: Dodaj swój pierwszy termin" }));
    expect(screen.queryByText("Dodaj swój pierwszy termin")).not.toBeInTheDocument();
    expect(localStorage.getItem("hint_org_first_term_dismissed")).toBe("1");
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

    const dateInput = await within(dialog).findByLabelText("Data i godzina");
    fireEvent.change(dateInput, { target: { value: "2026-02-01T17:00" } });

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
    const dateInput = await within(dialog).findByLabelText("Data i godzina");
    fireEvent.change(dateInput, { target: { value: "2026-02-01T17:00" } });

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

describe("PanelPage — Mój dom — no family", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  async function openMojDom() {
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Mój dom/ }));
  }

  it("renders the no-family empty-state card with a CTA for a GUEST", async () => {
    mockGuestDefaults();
    renderPanel();
    await openMojDom();

    expect(await screen.findByText("Nie masz jeszcze rodziny")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Załóż rodzinę" })).toBeInTheDocument();
  });

  it("renders the no-family empty-state card with a CTA for an ORGANIZER", async () => {
    mockOrganizerDefaults();
    renderPanel();
    await openMojDom();

    expect(await screen.findByText("Nie masz jeszcze rodziny")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Załóż rodzinę" })).toBeInTheDocument();
  });

  it("the CTA opens CreateFamilyDialog", async () => {
    mockGuestDefaults();
    renderPanel();
    await openMojDom();

    fireEvent.click(await screen.findByRole("button", { name: "Załóż rodzinę" }));

    const dialog = await screen.findByRole("dialog", { name: "Załóż rodzinę" });
    expect(within(dialog).getByLabelText("Nazwa rodziny")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Dalej" })).toBeInTheDocument();
  });

  it("step 1 submits the typed name to createOwnFamily and advances to step 2", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.createOwnFamily).mockResolvedValue({ ...mockFamily, name: "Nowakowie" });
    renderPanel();
    await openMojDom();
    fireEvent.click(await screen.findByRole("button", { name: "Załóż rodzinę" }));

    const dialog = await screen.findByRole("dialog", { name: "Załóż rodzinę" });
    fireEvent.change(within(dialog).getByLabelText("Nazwa rodziny"), { target: { value: "Nowakowie" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dalej" }));

    await waitFor(() => expect(familiesApi.createOwnFamily).toHaveBeenCalledWith("Nowakowie"));
    expect(familiesApi.createOwnFamily).toHaveBeenCalledTimes(1);
    expect(await within(dialog).findByRole("button", { name: "Zakończ" })).toBeInTheDocument();
  });

  it("step 2 with drafted members calls createLightweightMembers once with all rows, then the family shows in Mój dom", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.createOwnFamily).mockResolvedValue(mockFamily);
    vi.mocked(familiesApi.createLightweightMembers).mockResolvedValue({
      family: mockFamily,
      guardians: mockGuardians,
    });
    renderPanel();
    await openMojDom();
    fireEvent.click(await screen.findByRole("button", { name: "Załóż rodzinę" }));

    const dialog = await screen.findByRole("dialog", { name: "Załóż rodzinę" });
    fireEvent.change(within(dialog).getByLabelText("Nazwa rodziny"), { target: { value: "Kowalscy" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dalej" }));

    await within(dialog).findByRole("button", { name: "Zakończ" });

    fireEvent.change(within(dialog).getByLabelText("Imię i nazwisko"), { target: { value: "Marek Kowalski" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Opiekun" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj kolejną osobę" }));

    fireEvent.change(within(dialog).getByLabelText("Imię i nazwisko"), { target: { value: "Zosia Kowalska" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dziecko" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj kolejną osobę" }));

    // family exists after the silent refresh that follows the dialog
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians).mockResolvedValue(mockGuardians);

    fireEvent.click(within(dialog).getByRole("button", { name: "Zakończ" }));

    await waitFor(() =>
      expect(familiesApi.createLightweightMembers).toHaveBeenCalledWith([
        { name: "Marek Kowalski", role_type: "GUARDIAN" },
        { name: "Zosia Kowalska", role_type: "CHILD" },
      ]),
    );
    expect(familiesApi.createLightweightMembers).toHaveBeenCalledTimes(1);

    fireEvent.click(await within(dialog).findByRole("button", { name: "Gotowe" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Kowalscy", { selector: "h3" })).toBeInTheDocument();
  });

  it("reopening the dialog after closing mid-flow starts clean on step 1 (local state, no stale name/step)", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.createOwnFamily).mockResolvedValue(mockFamily);
    renderPanel();
    await openMojDom();
    fireEvent.click(await screen.findByRole("button", { name: "Załóż rodzinę" }));

    let dialog = await screen.findByRole("dialog", { name: "Załóż rodzinę" });
    fireEvent.change(within(dialog).getByLabelText("Nazwa rodziny"), { target: { value: "Kowalscy" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dalej" }));
    await within(dialog).findByRole("button", { name: "Zakończ" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Zamknij" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(await screen.findByRole("button", { name: "Załóż rodzinę" }));
    dialog = await screen.findByRole("dialog", { name: "Załóż rodzinę" });
    expect(within(dialog).getByLabelText("Nazwa rodziny")).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "Dalej" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Zakończ" })).not.toBeInTheDocument();
  });

  it("step 2 skipped makes no members call and the family is still visible", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.createOwnFamily).mockResolvedValue(mockFamily);
    renderPanel();
    await openMojDom();
    fireEvent.click(await screen.findByRole("button", { name: "Załóż rodzinę" }));

    const dialog = await screen.findByRole("dialog", { name: "Załóż rodzinę" });
    fireEvent.change(within(dialog).getByLabelText("Nazwa rodziny"), { target: { value: "Kowalscy" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dalej" }));

    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians).mockResolvedValue(mockGuardians);

    fireEvent.click(await within(dialog).findByRole("button", { name: "Zakończ" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Gotowe" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(familiesApi.createLightweightMembers).not.toHaveBeenCalled();
    expect(await screen.findByText("Kowalscy", { selector: "h3" })).toBeInTheDocument();
  });

  it("removing a middle draft member keeps the other rows' names/roles intact (stable keys, no bleed)", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.createOwnFamily).mockResolvedValue(mockFamily);
    renderPanel();
    await openMojDom();
    fireEvent.click(await screen.findByRole("button", { name: "Załóż rodzinę" }));

    const dialog = await screen.findByRole("dialog", { name: "Załóż rodzinę" });
    fireEvent.change(within(dialog).getByLabelText("Nazwa rodziny"), { target: { value: "Kowalscy" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dalej" }));
    await within(dialog).findByRole("button", { name: "Zakończ" });

    const addPerson = (name: string, role: "Opiekun" | "Dziecko") => {
      fireEvent.change(within(dialog).getByLabelText("Imię i nazwisko"), { target: { value: name } });
      fireEvent.click(within(dialog).getByRole("button", { name: role }));
      fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj kolejną osobę" }));
    };
    addPerson("Anna Nowak", "Opiekun");
    addPerson("Bartek Nowak", "Dziecko");
    addPerson("Celina Nowak", "Dziecko");

    const rows = within(dialog).getAllByRole("listitem");
    expect(rows).toHaveLength(3);

    // remove the middle row — with an array-index key this would shift the
    // third row's name/role onto the second position.
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Usuń" }));

    const remaining = within(dialog).getAllByRole("listitem");
    expect(remaining).toHaveLength(2);
    expect(remaining[0]).toHaveTextContent("Anna Nowak");
    expect(remaining[0]).toHaveTextContent("Opiekun");
    expect(remaining[1]).toHaveTextContent("Celina Nowak");
    expect(remaining[1]).toHaveTextContent("Dziecko");
    expect(within(dialog).queryByText("Bartek Nowak")).not.toBeInTheDocument();

    // and the surviving rows submit with the correct role mapping
    vi.mocked(familiesApi.createLightweightMembers).mockResolvedValue({
      family: mockFamily,
      guardians: mockGuardians,
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Zakończ" }));
    await waitFor(() =>
      expect(familiesApi.createLightweightMembers).toHaveBeenCalledWith([
        { name: "Anna Nowak", role_type: "GUARDIAN" },
        { name: "Celina Nowak", role_type: "CHILD" },
      ]),
    );
  });
});

describe("PanelPage — Mój dom — inline family rename", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  async function openMojDom() {
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Mój dom/ }));
    await screen.findByRole("heading", { name: "Mój dom", level: 2 });
  }

  it("calls renameFamily and updates the heading in place", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians).mockResolvedValue(mockGuardians);
    vi.mocked(familiesApi.renameFamily).mockResolvedValue({ ...mockFamily, name: "Nowakowie" });
    renderPanel();
    await openMojDom();

    fireEvent.click(screen.getByRole("button", { name: "Zmień nazwę rodziny" }));
    const input = screen.getByLabelText("Nazwa rodziny");
    fireEvent.change(input, { target: { value: "Nowakowie" } });

    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([{ ...mockFamily, name: "Nowakowie" }]);
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await waitFor(() => expect(familiesApi.renameFamily).toHaveBeenCalledWith(10, "Nowakowie"));
    expect(await screen.findByText("Nowakowie", { selector: "h3" })).toBeInTheDocument();
  });

  it("network error shows an inline message and restores the previous name", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians).mockResolvedValue(mockGuardians);
    vi.mocked(familiesApi.renameFamily).mockRejectedValue(new Error("network"));
    renderPanel();
    await openMojDom();

    fireEvent.click(screen.getByRole("button", { name: "Zmień nazwę rodziny" }));
    fireEvent.change(screen.getByLabelText("Nazwa rodziny"), { target: { value: "Nowakowie" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(await screen.findByText(/Nie udało się zmienić nazwy/)).toBeInTheDocument();
    expect(screen.getByText("Kowalscy", { selector: "h3" })).toBeInTheDocument();
  });
});

describe("PanelPage — Mój dom — remove family member", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  async function openMojDom() {
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Mój dom/ }));
    await screen.findByRole("heading", { name: "Mój dom", level: 2 });
  }

  it("removes a family member and refreshes the list", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians)
      .mockResolvedValueOnce(mockGuardians)
      .mockResolvedValueOnce([mockGuardians[0]]);
    vi.mocked(familiesApi.removeFamilyMember).mockResolvedValue(undefined);
    renderPanel();
    await openMojDom();

    expect(screen.getByText("Marek Kowalski", { selector: "h3" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Usuń członka rodziny Marek Kowalski" }));

    await waitFor(() =>
      expect(familiesApi.removeFamilyMember).toHaveBeenCalledWith(10, 2),
    );
    await waitFor(() =>
      expect(screen.queryByText("Marek Kowalski", { selector: "h3" })).not.toBeInTheDocument(),
    );
  });

  it("shows an inline error when member removal is rejected (e.g. last guardian 409)", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians).mockResolvedValue(mockGuardians);
    vi.mocked(familiesApi.removeFamilyMember).mockRejectedValue(
      new ApiError(409, "Conflict", { message: "Nie można usunąć jedynego opiekuna rodziny" }),
    );
    renderPanel();
    await openMojDom();

    fireEvent.click(screen.getByRole("button", { name: "Usuń członka rodziny Marek Kowalski" }));

    expect(
      await screen.findByText("Nie można usunąć jedynego opiekuna rodziny"),
    ).toBeInTheDocument();
    expect(screen.getByText("Marek Kowalski", { selector: "h3" })).toBeInTheDocument();
  });
});

describe("PanelPage — term edit dialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const term = {
    id: 1,
    circle_group_id: 5,
    occurs_on: "2026-02-01",
    description: "Pierwsze zajęcia",
    created_at: "",
    updated_at: "",
  };

  async function openEditDialog() {
    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));
    await screen.findByRole("heading", { name: "Terminy" });
    fireEvent.click((await screen.findAllByRole("button", { name: "Edytuj termin" }))[0]);
    return screen.findByRole("dialog", { name: "Edytuj termin" });
  }

  it("calls updateTerm with only the changed occurs_on field", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([term]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    vi.mocked(termsApi.updateTerm).mockResolvedValue({ ...term, occurs_on: "2026-03-09T18:00:00" });
    renderPanel();
    const dialog = await openEditDialog();

    fireEvent.change(within(dialog).getByLabelText("Data i godzina"), { target: { value: "2026-03-09T18:00" } });
    vi.mocked(termsApi.getTerms).mockResolvedValue([{ ...term, occurs_on: "2026-03-09T18:00:00" }]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Zapisz" }));

    await waitFor(() =>
      expect(termsApi.updateTerm).toHaveBeenCalledWith(1, { occurs_on: "2026-03-09T18:00" }),
    );
    // a silent reload runs after the successful save
    await waitFor(() => expect(vi.mocked(termsApi.getTerms).mock.calls.length).toBeGreaterThan(1));
  });

  it("shows an inline error and stays open when the save is rejected", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([term]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    vi.mocked(termsApi.updateTerm).mockRejectedValue(new Error("400"));
    renderPanel();
    const dialog = await openEditDialog();

    fireEvent.change(within(dialog).getByLabelText("Opis"), { target: { value: "Zmieniony opis" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Zapisz" }));

    expect(await within(dialog).findByText(/Nie udało się zapisać zmian terminu/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Edytuj termin" })).toBeInTheDocument();
  });

  it("closes without calling updateTerm when nothing changed", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([term]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    renderPanel();
    const dialog = await openEditDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Zapisz" }));

    expect(termsApi.updateTerm).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Edytuj termin" })).not.toBeInTheDocument(),
    );
  });
});

describe("PanelPage — circle rename", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  async function openGrupy() {
    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));
    await screen.findByRole("heading", { name: "Grupy" });
  }

  it("renames the circle in place on success", async () => {
    mockOrganizerDefaults();
    vi.mocked(groupsApi.updateCircle).mockResolvedValue({ ...mockGroup, name: "Nutki" });
    renderPanel();
    await openGrupy();

    fireEvent.click(await screen.findByRole("button", { name: "Zmień nazwę kręgu" }));
    fireEvent.change(screen.getByLabelText("Nazwa kręgu"), { target: { value: "Nutki" } });

    vi.mocked(groupsApi.getGroup).mockResolvedValue({ ...mockGroup, name: "Nutki" });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await waitFor(() => expect(groupsApi.updateCircle).toHaveBeenCalledWith(5, { name: "Nutki" }));
    expect(await screen.findByText("Nutki", { selector: "h3" })).toBeInTheDocument();
  });

  it("shows an inline error on a rejected rename", async () => {
    mockOrganizerDefaults();
    vi.mocked(groupsApi.updateCircle).mockRejectedValue(new Error("400"));
    renderPanel();
    await openGrupy();

    fireEvent.click(await screen.findByRole("button", { name: "Zmień nazwę kręgu" }));
    fireEvent.change(screen.getByLabelText("Nazwa kręgu"), { target: { value: "Nutki" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(await screen.findByText(/Nie udało się zmienić nazwy kręgu/)).toBeInTheDocument();
    expect(screen.getByText("Nowa grupa", { selector: "h3" })).toBeInTheDocument();
  });
});

describe("PanelPage — Zapisane zajęcia", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders one tile per attendance with a public-term link (GUEST)", async () => {
    mockGuestDefaults();
    vi.mocked(groupsApi.getMyAttendances).mockResolvedValue(mockAttendances);
    renderPanel();

    await screen.findByRole("heading", { name: "Zapisane zajęcia" });
    const first = await screen.findByRole("link", { name: /Nutki dla starszaków/ });
    expect(first).toHaveAttribute("href", "/ania-kowalska/grupa/5/term/3");
    expect(first).toHaveTextContent("Ania Kowalska");
    const second = screen.getByRole("link", { name: /Rytmika/ });
    expect(second).toHaveAttribute("href", "/basia-nowak/grupa/6/term/8");
  });

  it("renders a dashed empty state and no error when there are no attendances", async () => {
    mockGuestDefaults();
    renderPanel();

    await screen.findByRole("heading", { name: "Zapisane zajęcia" });
    expect(screen.getByText("Nie zapisałeś się jeszcze na żadne zajęcia.")).toBeInTheDocument();
    expect(screen.queryByText(/Nie udało się/)).not.toBeInTheDocument();
  });

  it("renders the empty state and no error when getMyAttendances rejects (load() guard)", async () => {
    mockGuestDefaults();
    vi.mocked(groupsApi.getMyAttendances).mockRejectedValue(new Error("500"));
    renderPanel();

    await screen.findByRole("heading", { name: /Cześć/ });
    expect(await screen.findByRole("heading", { name: "Zapisane zajęcia" })).toBeInTheDocument();
    expect(screen.getByText("Nie zapisałeś się jeszcze na żadne zajęcia.")).toBeInTheDocument();
    expect(screen.queryByText(/Nie udało się/)).not.toBeInTheDocument();
  });

  it("the section is present for an ORGANIZER too", async () => {
    mockOrganizerDefaults();
    vi.mocked(groupsApi.getMyAttendances).mockResolvedValue(mockAttendances);
    renderPanel();

    await screen.findByRole("heading", { name: "Zapisane zajęcia" });
    expect(await screen.findByRole("link", { name: /Nutki dla starszaków/ })).toBeInTheDocument();
  });
});

describe("PanelPage — Spotkania list links to the public circle page", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("each term row in the Spotkania list is a link (the whole tile) to the per-term public page, not the authenticated one", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "" },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));

    const link = await screen.findByRole("link", { name: new RegExp(mockGroup.name) });
    expect(link).toHaveAttribute("href", `/${mockGroup.organizer_slug}/grupa/${mockGroup.id}/term/1`);
  });
});

describe("PanelPage — per-term public links & copy-link button", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("organizer with no Organization — 'Terminy' row still links to the per-term public page via the hash slug", async () => {
    mockOrganizerDefaults();
    vi.mocked(groupsApi.getGroup).mockResolvedValue(mockGroupHashSlug);
    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "" },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));

    const link = await screen.findByRole("link", { name: new RegExp(mockGroup.name) });
    expect(link).toHaveAttribute("href", `/${mockGroupHashSlug.organizer_slug}/grupa/${mockGroup.id}/term/1`);
  });

  it("copy-link button on an organizer 'Terminy' row writes the absolute per-term URL and toasts", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "" },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));

    const copyBtn = await screen.findByRole("button", { name: "Kopiuj link do terminu" });
    expect(copyBtn).not.toBeDisabled();
    fireEvent.click(copyBtn);

    expect(clipboardWriteText).toHaveBeenCalledWith(
      `${window.location.origin}/${mockGroup.organizer_slug}/grupa/${mockGroup.id}/term/1`,
    );
    expect(await screen.findByText("Skopiowano link")).toBeInTheDocument();
  });

  it("organizer first-term stepper done-screen CTA deep-links to the just-created term using the circle's slug", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.createTerm).mockResolvedValue({
      id: 7, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "",
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Dodaj termin →" }));

    const dialog = await screen.findByRole("dialog", { name: "Dodaj pierwszy termin" });
    fireEvent.change(await within(dialog).findByLabelText("Data i godzina"), { target: { value: "2026-02-01T17:00" } });

    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: 7, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "" },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj termin" }));

    const publicLink = await within(dialog).findByRole("link", { name: /Przejdź do publicznej strony/ });
    expect(publicLink).toHaveAttribute("href", `/${mockGroup.organizer_slug}/grupa/5/term/7`);
  });
});

describe("PanelPage — needed item sub-CRUD (in the term dialog)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const term = {
    id: 1,
    circle_group_id: 5,
    occurs_on: "2026-02-01",
    description: "Zajęcia",
    created_at: "",
    updated_at: "",
  };
  const neededItem = {
    id: 11,
    term_id: 1,
    product_id: 5,
    product_name: "Bębenek",
    product_category: "OTHER" as const,
    description: "mały",
    created_at: "",
    updated_at: "",
  };

  function mockTermWithNeeded() {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([term]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([neededItem]);
  }

  async function openEditDialog() {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Edytuj termin" }))[0]);
    return screen.findByRole("dialog", { name: "Edytuj termin" });
  }

  it("adds a needed item via the dialog add row (resolveProduct then createNeededItem)", async () => {
    mockTermWithNeeded();
    vi.mocked(productsApi.resolveProduct).mockResolvedValue({
      id: 42, name: "Mata", description: null, photoUrl: null, price: 0.01, sku: "MATA-1",
      category: "OTHER", pluginData: null, createdAt: "", updatedAt: "",
    });
    vi.mocked(termsApi.createNeededItem).mockResolvedValue({
      id: 12, term_id: 1, product_id: 42, product_name: "Mata", product_category: "OTHER",
      description: "Koc", created_at: "", updated_at: "",
    });
    const dialog = await openEditDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj potrzebną rzecz" }));
    fireEvent.change(within(dialog).getByLabelText("Nazwa nowej rzeczy"), { target: { value: "Mata" } });
    fireEvent.change(within(dialog).getByLabelText("Doprecyzowanie nowej rzeczy"), { target: { value: "Koc" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj" }));

    await waitFor(() =>
      expect(productsApi.resolveProduct).toHaveBeenCalledWith({ name: "Mata", category: "OTHER" }),
    );
    await waitFor(() =>
      expect(termsApi.createNeededItem).toHaveBeenCalledWith({
        term_id: 1, product_id: 42, description: "Koc",
      }),
    );
  });

  it("edits a needed item's description only via the dialog (no resolveProduct)", async () => {
    mockTermWithNeeded();
    vi.mocked(termsApi.updateNeededItem).mockResolvedValue({ ...neededItem, description: "duży" });
    const dialog = await openEditDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Edytuj potrzebną rzecz" }));
    fireEvent.change(within(dialog).getByLabelText("Doprecyzowanie rzeczy"), { target: { value: "duży" } });
    const row = within(dialog).getByRole("listitem");
    fireEvent.click(within(row).getByRole("button", { name: "Zapisz" }));

    await waitFor(() =>
      expect(termsApi.updateNeededItem).toHaveBeenCalledWith(11, { description: "duży" }),
    );
    expect(productsApi.resolveProduct).not.toHaveBeenCalled();
  });

  it("deletes a needed item via the dialog (await-then-refresh)", async () => {
    mockTermWithNeeded();
    vi.mocked(termsApi.deleteNeededItem).mockResolvedValue(undefined);
    const dialog = await openEditDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Usuń potrzebną rzecz" }));

    await waitFor(() => expect(termsApi.deleteNeededItem).toHaveBeenCalledWith(11));
  });

  it("keeps the row and shows an inline message when delete returns 409", async () => {
    mockTermWithNeeded();
    vi.mocked(termsApi.deleteNeededItem).mockRejectedValue(Object.assign(new Error("409"), { status: 409 }));
    const dialog = await openEditDialog();

    expect(within(dialog).getByText(/Bębenek/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Usuń potrzebną rzecz" }));

    expect(await within(dialog).findByText(/Nie udało się usunąć/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Bębenek/)).toBeInTheDocument();
  });
});

describe("PanelPage — inventory item edit/delete", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const invItem = {
    id: 21,
    inventory_id: 1,
    product_id: 7,
    condition: "GOOD" as const,
    added_at: "",
    created_at: "",
    updated_at: "",
  };
  const product = {
    id: 7,
    name: "Rowerek",
    description: null,
    photoUrl: null,
    price: 0,
    sku: "SKU7",
    category: "TOY" as const,
    pluginData: null,
    createdAt: "",
    updatedAt: "",
  };

  function mockItems() {
    mockGuestDefaults();
    vi.mocked(inventoriesApi.getInventoryItems).mockResolvedValue([invItem]);
    vi.mocked(productsApi.getProducts).mockResolvedValue([product]);
  }

  it("edits an item's condition inline in 'Moje rzeczy'", async () => {
    mockItems();
    vi.mocked(inventoriesApi.updateInventoryItem).mockResolvedValue({ ...invItem, condition: "NEW" });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Moje rzeczy" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edytuj stan rzeczy" }));
    fireEvent.change(screen.getByLabelText("Stan rzeczy"), { target: { value: "NEW" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await waitFor(() =>
      expect(inventoriesApi.updateInventoryItem).toHaveBeenCalledWith(21, { condition: "NEW" }),
    );
  });

  it("edits an item name+category → resolveProduct then updateInventoryItem with the new product_id", async () => {
    mockItems();
    vi.mocked(productsApi.resolveProduct).mockResolvedValue({ ...product, id: 99, name: "Hulajnoga" });
    vi.mocked(inventoriesApi.updateInventoryItem).mockResolvedValue({ ...invItem, product_id: 99 });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Moje rzeczy" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edytuj rzecz Rowerek" }));
    fireEvent.change(screen.getByLabelText("Nazwa rzeczy"), { target: { value: "Hulajnoga" } });
    fireEvent.change(screen.getByLabelText("Typ rzeczy"), { target: { value: "GAME" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await waitFor(() =>
      expect(productsApi.resolveProduct).toHaveBeenCalledWith({ name: "Hulajnoga", category: "GAME" }),
    );
    await waitFor(() =>
      expect(inventoriesApi.updateInventoryItem).toHaveBeenCalledWith(21, { product_id: 99 }),
    );
  });

  it("shows an inline error when the item name save is rejected", async () => {
    mockItems();
    vi.mocked(productsApi.resolveProduct).mockRejectedValue(new Error("500"));
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Moje rzeczy" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edytuj rzecz Rowerek" }));
    fireEvent.change(screen.getByLabelText("Nazwa rzeczy"), { target: { value: "Hulajnoga" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(await screen.findByText(/Nie udało się zapisać zmian/)).toBeInTheDocument();
  });

  it("optimistically deletes an item and restores it on a 409", async () => {
    mockItems();
    vi.mocked(inventoriesApi.deleteInventoryItem).mockRejectedValue(
      Object.assign(new Error("409"), { status: 409 }),
    );
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Moje rzeczy" }));
    expect(await screen.findByText("Rowerek")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Usuń rzecz Rowerek" }));

    expect(screen.getByRole("status")).toHaveTextContent("Usunięto");
    expect(await screen.findByText(/Nie udało się usunąć/)).toBeInTheDocument();
    expect(screen.getByText("Rowerek")).toBeInTheDocument();
  });
});

describe("PanelPage — needed item edit error path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const term = {
    id: 1,
    circle_group_id: 5,
    occurs_on: "2026-02-01",
    description: "Zajęcia",
    created_at: "",
    updated_at: "",
  };
  const neededItem = {
    id: 11,
    term_id: 1,
    product_id: 5,
    product_name: "Bębenek",
    product_category: "OTHER" as const,
    description: "mały",
    created_at: "",
    updated_at: "",
  };

  it("shows an inline error and keeps the original needed item when the edit is rejected", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([term]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([neededItem]);
    vi.mocked(termsApi.updateNeededItem).mockRejectedValue(new Error("500"));
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Edytuj termin" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Edytuj termin" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Edytuj potrzebną rzecz" }));
    fireEvent.change(within(dialog).getByLabelText("Doprecyzowanie rzeczy"), {
      target: { value: "Coś innego" },
    });
    const row = within(dialog).getByRole("listitem");
    fireEvent.click(within(row).getByRole("button", { name: "Zapisz" }));

    expect(await within(dialog).findByText(/Nie udało się zapisać zmiany/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Bębenek/)).toBeInTheDocument();
  });
});
