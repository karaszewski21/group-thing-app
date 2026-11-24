import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as familiesApi from "../api/families";
import * as groupsApi from "../api/groups";
import * as inventoriesApi from "../api/inventories";
import * as locationsApi from "../api/locations";
import * as organizationsApi from "../api/organizations";
import * as peopleApi from "../api/people";
import * as pledgesApi from "../api/pledges";
import * as pointsApi from "../api/points";
import * as termsApi from "../api/terms";
import { AppDataProvider } from "../features/panel/AppDataContext";
import { GroupCreateView } from "../features/groups/GroupCreateView";
import { GroupEditView } from "../features/groups/GroupEditView";
import { AddTermView } from "../features/terms/AddTermView";
import { FirstTermStepperOrganizer } from "../features/terms/FirstTermStepperOrganizer";
import { newTermDraft } from "../features/terms/termDraft";
import { makeLocationRef, makeLocationResponse } from "./fixtures/locations";
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
vi.mock("../api/points", () => ({ getAttendanceRules: vi.fn() }));
vi.mock("../api/terms", () => ({
  createTerm: vi.fn(),
  createNeededItem: vi.fn(),
  getTerms: vi.fn(),
  getNeededItemsForTerms: vi.fn(),
}));

const GROUP_ID = "6a1b2c3d-4e5f-4a6b-8c7d-0000000000a1";
const PAY_URL = "https://pay.example.pl/krag";
const PRICE_LABEL = "Cena domyślna (zł)";
const URL_LABEL = "Link do płatności (opcjonalnie)";
const REQUIRES_PRICE = "Link wymaga ceny — wpisz cenę albo usuń link.";

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
  description: null,
  organizer_slug: "anna",
  layout_mode: "CIRCLE",
  visibility: "PUBLIC",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  default_location: makeLocationRef({ id: "loc-1" }),
  default_capacity: null,
  default_price: "25.50",
  default_payment_url: PAY_URL,
  default_payment_method: "EXTERNAL_LINK",
};

const term: termsApi.TermResponse = {
  id: "t1",
  group_id: GROUP_ID,
  occurs_on: "2026-12-06T10:00:00",
  description: null,
  created_at: "2026-11-01T10:00:00",
  updated_at: "2026-11-01T10:00:00",
  attendee_count: 0,
  child_count: 0,
  price: "25.50",
  payment_url: PAY_URL,
  payment_method: "EXTERNAL_LINK",
};

function renderAt(ui: ReactElement, url: string, pattern: string) {
  return renderWithRoute(<AppDataProvider>{ui}</AppDataProvider>, { url, pattern, wrapper: createQueryWrapper() });
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
  vi.mocked(locationsApi.getMyLocations).mockResolvedValue([makeLocationResponse({ id: "loc-1" })]);
  vi.mocked(pointsApi.getAttendanceRules).mockResolvedValue({ levels: [5, 10], min_present: 3, auto_close_days: 7 });
  vi.mocked(termsApi.createTerm).mockResolvedValue(term);
});

const PREFILL_HINT = "Cena i link podpowiedziane z ustawień kręgu — możesz je zmienić.";

describe("Circle form — default price and payment link", () => {
  it("create sends the canonical default_price and the link, after the capacity field", async () => {
    vi.mocked(groupsApi.createAdditionalMyCircle).mockResolvedValue(group);
    renderAt(<GroupCreateView />, "/groups/new", "/groups/new");
    fireEvent.change(await screen.findByLabelText("Nazwa grupy"), { target: { value: "Mamy z Ruczaju" } });
    const price = screen.getByLabelText(PRICE_LABEL);
    const url = screen.getByLabelText(URL_LABEL);
    const follows = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(screen.getByLabelText("Ile miejsc (opcjonalnie)").compareDocumentPosition(price) & follows).toBeTruthy();
    expect(price.compareDocumentPosition(url) & follows).toBeTruthy();
    expect(price).toHaveAccessibleDescription("Puste = zajęcia bezpłatne.");
    expect(url).toHaveAccessibleDescription("Bez linku uczestnicy płacą na miejscu.");

    fireEvent.change(price, { target: { value: "25,5" } });
    fireEvent.change(url, { target: { value: ` ${PAY_URL} ` } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj grupę" }));

    await waitFor(() =>
      expect(groupsApi.createAdditionalMyCircle).toHaveBeenCalledWith(
        expect.objectContaining({ default_price: "25.50", default_payment_url: PAY_URL }),
      ),
    );
  });

  it("edit seeds both fields from the group and sends null for cleared ones; a link without a price blocks submit", async () => {
    vi.mocked(groupsApi.updateGroup).mockResolvedValue(group);
    renderAt(<GroupEditView />, `/groups/${GROUP_ID}/edit`, "/groups/:groupId/edit");
    const price = await screen.findByLabelText(PRICE_LABEL);
    const url = screen.getByLabelText(URL_LABEL);
    expect(price).toHaveValue("25,50");
    expect(url).toHaveValue(PAY_URL);

    fireEvent.change(price, { target: { value: "" } });
    expect(screen.getByRole("alert")).toHaveTextContent(REQUIRES_PRICE);
    const save = screen.getByRole("button", { name: "Zapisz" });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(groupsApi.updateGroup).not.toHaveBeenCalled();

    fireEvent.change(url, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await waitFor(() =>
      expect(groupsApi.updateGroup).toHaveBeenCalledWith(
        GROUP_ID,
        expect.objectContaining({ default_price: null, default_payment_url: null }),
      ),
    );
  });
});

describe("Dodaj termin — price and payment link", () => {
  it("prefills from the picked circle, blocks submit on Link wymaga ceny and sends both fields explicitly", async () => {
    renderAt(<AddTermView />, "/add/term", "/add/term");
    const price = await screen.findByLabelText("Cena (zł)");
    const url = screen.getByLabelText(URL_LABEL);
    await waitFor(() => expect(price).toHaveValue("25,50"));
    expect(url).toHaveValue(PAY_URL);
    const follows = Node.DOCUMENT_POSITION_FOLLOWING;
    // The prefill hint sits under the page title, above the form, not on the price field.
    const hint = screen.getByText(PREFILL_HINT);
    expect(hint.compareDocumentPosition(screen.getByLabelText("Grupa")) & follows).toBeTruthy();
    expect(price).not.toHaveAccessibleDescription(PREFILL_HINT);
    expect(screen.getByLabelText("Ile miejsc").compareDocumentPosition(price) & follows).toBeTruthy();

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Miejsce" })).toHaveValue("loc-1"));
    fireEvent.change(screen.getByLabelText("Data i godzina"), { target: { value: "2026-12-06T10:00" } });
    fireEvent.change(price, { target: { value: "" } });

    expect(screen.getByRole("alert")).toHaveTextContent(REQUIRES_PRICE);
    const submit = screen.getByRole("button", { name: "Dodaj termin" });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(termsApi.createTerm).not.toHaveBeenCalled();

    fireEvent.change(price, { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj termin" }));

    await waitFor(() =>
      expect(termsApi.createTerm).toHaveBeenCalledWith(
        expect.objectContaining({ group_id: GROUP_ID, price: "30.00", payment_url: PAY_URL }),
      ),
    );
  });
});

/** The stepper alone, its draft held as the panel would hold it. */
function StepperWithDefaults({ defaultPrice, defaultPaymentUrl }: { defaultPrice: string; defaultPaymentUrl: string }) {
  const defaultLocation = makeLocationRef({ id: "loc-1" });
  const [draft, setDraft] = useState(() => newTermDraft(defaultLocation, null, defaultPrice, defaultPaymentUrl));
  return (
    <FirstTermStepperOrganizer
      draft={draft}
      onDraftChange={setDraft}
      onClose={() => {}}
      onAddPlace={() => {}}
      circleGroupId={GROUP_ID}
      organizerSlug={null}
      onDone={() => {}}
      defaultLocation={defaultLocation}
      defaultCapacity={null}
      defaultPrice={defaultPrice}
      defaultPaymentUrl={defaultPaymentUrl}
    />
  );
}

describe("First-term stepper — circle with a default link", () => {
  it("clearing the price blocks submit until the link is cleared too, then sends both as explicit null", async () => {
    renderWithRoute(<StepperWithDefaults defaultPrice="25.50" defaultPaymentUrl={PAY_URL} />, {
      url: "/",
      wrapper: createQueryWrapper(),
    });
    const price = await screen.findByLabelText("Cena (zł)");
    const url = screen.getByLabelText(URL_LABEL);
    expect(price).toHaveValue("25,50");
    expect(url).toHaveValue(PAY_URL);
    const hint = screen.getByText(PREFILL_HINT);
    expect(hint.compareDocumentPosition(screen.getByLabelText("Data i godzina")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Miejsce" })).not.toHaveValue(""));
    fireEvent.change(screen.getByLabelText("Data i godzina"), { target: { value: "2026-12-06T10:00" } });

    fireEvent.change(price, { target: { value: "" } });
    expect(screen.getByRole("alert")).toHaveTextContent(REQUIRES_PRICE);
    expect(screen.getByRole("button", { name: "Dodaj termin" })).toBeDisabled();

    fireEvent.change(url, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj termin" }));

    await waitFor(() =>
      expect(termsApi.createTerm).toHaveBeenCalledWith({
        group_id: GROUP_ID,
        occurs_on: "2026-12-06T10:00",
        location_id: "loc-1",
        price: null,
        payment_url: null,
      }),
    );
  });
});
