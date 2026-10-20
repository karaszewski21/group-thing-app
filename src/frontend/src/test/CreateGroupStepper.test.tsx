import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import * as groupsApi from "../api/groups";
import type { GroupResponse } from "../api/groups";
import * as locationsApi from "../api/locations";
import type { LocationResponse } from "../api/locations";
import * as termsApi from "../api/terms";
import type { TermResponse } from "../api/terms";
import { CreateGroupStepper } from "../components/panel/CreateGroupStepper";
import { termPublicPath } from "../pages/panel/panelHelpers";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/groups", () => ({ createAdditionalMyCircle: vi.fn(), updateGroup: vi.fn() }));
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

const GROUP: GroupResponse = {
  id: "g-1",
  party_id: "p-1",
  name: "Nutki",
  organizer_slug: "k-abc123",
  layout_mode: "CIRCLE",
  visibility: "PRIVATE",
  created_at: "",
  updated_at: "",
  default_location: null,
  default_capacity: null,
};

const TERM: TermResponse = {
  id: "t-1",
  circle_group_id: "g-1",
  occurs_on: "2026-10-24T17:00:00",
  description: null,
  created_at: "",
  updated_at: "",
  attendee_count: null,
  child_count: null,
};

function renderStepper(organizationSlug: string | null = null) {
  const props = { onClose: vi.fn(), onCircleCreated: vi.fn(), onDone: vi.fn() };
  const view = render(
    <MemoryRouter>
      <CreateGroupStepper organizationSlug={organizationSlug} {...props} />
    </MemoryRouter>,
    { wrapper: createQueryWrapper() },
  );
  return { ...props, ...view };
}

async function submitStep1(name = "Nutki") {
  fireEvent.change(await screen.findByLabelText("Nazwa grupy"), { target: { value: name } });
  await screen.findByRole("combobox", { name: "Stałe miejsce spotkań (opcjonalnie)" });
  fireEvent.click(screen.getByRole("button", { name: "Dalej →" }));
}

async function submitStep2() {
  fireEvent.change(await screen.findByLabelText("Data i godzina"), { target: { value: "2026-10-24T17:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Dodaj" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(locationsApi.getMyLocations).mockResolvedValue([SWIETLICA]);
  vi.mocked(groupsApi.createAdditionalMyCircle).mockResolvedValue(GROUP);
  vi.mocked(termsApi.createTerm).mockResolvedValue(TERM);
});

describe("CreateGroupStepper", () => {
  it('is a 2-step "Załóż grupę" flow without an organization step', async () => {
    renderStepper();

    const dialog = screen.getByRole("dialog", { name: "Załóż grupę" });
    expect(dialog.querySelectorAll('[aria-hidden="true"] > span')).toHaveLength(2);
    expect(within(dialog).queryByLabelText("Nazwa organizacji")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Dalej →" })).toBeDisabled();

    await submitStep1();

    expect(await screen.findByText("Pierwszy termin w grupie „Nutki”")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Załóż grupę" })).toBeInTheDocument();
  });

  it("defaults visibility to PRIVATE without an Organization and to PUBLIC with one", () => {
    const { unmount } = renderStepper(null);
    expect(screen.getByLabelText("Widoczność grupy")).toHaveValue("PRIVATE");
    unmount();

    renderStepper("studio-nutka");
    expect(screen.getByLabelText("Widoczność grupy")).toHaveValue("PUBLIC");
  });

  it("creates the group with the exact step-1 payload and notifies the host", async () => {
    const { onCircleCreated } = renderStepper();

    fireEvent.change(await screen.findByLabelText("Nazwa grupy"), { target: { value: "  Nutki  " } });
    fireEvent.change(await screen.findByRole("combobox", { name: "Stałe miejsce spotkań (opcjonalnie)" }), {
      target: { value: "loc-1" },
    });
    fireEvent.change(screen.getByLabelText("Ile miejsc (opcjonalnie)"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Dalej →" }));

    await waitFor(() =>
      expect(groupsApi.createAdditionalMyCircle).toHaveBeenCalledWith({
        name: "Nutki",
        visibility: "PRIVATE",
        default_location_id: "loc-1",
        default_capacity: 12,
      }),
    );
    await waitFor(() => expect(onCircleCreated).toHaveBeenCalled());
  });

  it("prefills step 2 from the created group's default place and capacity", async () => {
    vi.mocked(groupsApi.createAdditionalMyCircle).mockResolvedValue({
      ...GROUP,
      default_location: SWIETLICA,
      default_capacity: 12,
    });
    renderStepper();
    await submitStep1();

    await screen.findByText("Pierwszy termin w grupie „Nutki”");
    expect(await screen.findByRole("combobox", { name: "Miejsce" })).toHaveDisplayValue("Świetlica na Polnej");
    expect(screen.getByLabelText("Ile miejsc")).toHaveValue(12);

    await submitStep2();
    await waitFor(() =>
      expect(termsApi.createTerm).toHaveBeenCalledWith({
        circle_group_id: "g-1",
        occurs_on: "2026-10-24T17:00",
        description: undefined,
        location_id: "loc-1",
        capacity: 12,
      }),
    );
  });

  it("sends explicit nulls when the prefilled place and capacity are cleared", async () => {
    vi.mocked(groupsApi.createAdditionalMyCircle).mockResolvedValue({
      ...GROUP,
      default_location: SWIETLICA,
      default_capacity: 12,
    });
    renderStepper();
    await submitStep1();

    await screen.findByText("Pierwszy termin w grupie „Nutki”");
    fireEvent.change(await screen.findByRole("combobox", { name: "Miejsce" }), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Ile miejsc"), { target: { value: "" } });
    await submitStep2();

    await waitFor(() =>
      expect(termsApi.createTerm).toHaveBeenCalledWith({
        circle_group_id: "g-1",
        occurs_on: "2026-10-24T17:00",
        description: undefined,
        location_id: null,
        capacity: null,
      }),
    );
  });

  it('"← Wstecz" then a changed step 1 updates the created group instead of creating another', async () => {
    vi.mocked(groupsApi.updateGroup).mockResolvedValue({ ...GROUP, name: "Nutki II" });
    renderStepper();
    await submitStep1();

    fireEvent.click(await screen.findByRole("button", { name: "← Wstecz" }));
    expect(screen.getByLabelText("Nazwa grupy")).toHaveValue("Nutki");
    fireEvent.change(screen.getByLabelText("Nazwa grupy"), { target: { value: "Nutki II" } });
    fireEvent.click(screen.getByRole("button", { name: "Dalej →" }));

    await waitFor(() =>
      expect(groupsApi.updateGroup).toHaveBeenCalledWith("g-1", {
        name: "Nutki II",
        visibility: "PRIVATE",
        default_location_id: null,
        default_capacity: null,
      }),
    );
    expect(groupsApi.createAdditionalMyCircle).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Pierwszy termin w grupie „Nutki II”")).toBeInTheDocument();
  });

  it("the done screen links to the term's public page and Gotowe finishes", async () => {
    const { onDone } = renderStepper();
    await submitStep1();
    await submitStep2();

    expect(
      await screen.findByText(
        "Grupa założona, termin dodany! Tę stronę zobaczy każdy, kto dostanie link — bez logowania.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Przejdź do publicznej strony →" })).toHaveAttribute(
      "href",
      termPublicPath(GROUP, TERM.id),
    );
    fireEvent.click(screen.getByRole("button", { name: "Gotowe" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("offers the /organization CTA on the done screen only to a user without an Organization", async () => {
    const first = renderStepper(null);
    await submitStep1();
    await submitStep2();
    const cta = await screen.findByRole("link", { name: "Stwórz publiczną wizytówkę / własny adres →" });
    expect(cta).toHaveAttribute("href", "/organization");
    fireEvent.click(cta);
    expect(first.onDone).toHaveBeenCalled();
    first.unmount();

    renderStepper("studio-nutka");
    await submitStep1();
    await submitStep2();
    await screen.findByRole("link", { name: "Przejdź do publicznej strony →" });
    expect(screen.queryByRole("link", { name: /Stwórz publiczną wizytówkę/ })).not.toBeInTheDocument();
  });
});
