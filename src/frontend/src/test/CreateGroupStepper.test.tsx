import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import * as groupsApi from "../api/groups";
import type { GroupResponse } from "../api/groups";
import * as locationsApi from "../api/locations";
import type { LocationRefResponse, LocationResponse } from "../api/locations";
import * as termsApi from "../api/terms";
import type { TermResponse } from "../api/terms";
import { CreateGroupStepper } from "../components/panel/CreateGroupStepper";
import { termPublicPath } from "../utils/appHelpers";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/groups", () => ({
  createAdditionalMyCircle: vi.fn(),
  updateGroup: vi.fn(),
  getJoinCode: vi.fn(),
  regenerateJoinCode: vi.fn(),
}));
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

const SWIETLICA_REF: LocationRefResponse = {
  id: SWIETLICA.id,
  name: SWIETLICA.name,
  formatted_address: SWIETLICA.formatted_address,
  google_place_id: SWIETLICA.google_place_id,
  notes: SWIETLICA.notes,
  deleted_at: SWIETLICA.deleted_at,
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

const PUBLIC_DONE = "Grupa założona, termin dodany! Tę stronę zobaczy każdy, kto dostanie link — bez logowania.";
const PRIVATE_DONE =
  "Grupa założona, termin dodany! Grupa jest prywatna — dołączą tylko osoby, którym podasz kod dostępu.";

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
  vi.mocked(groupsApi.getJoinCode).mockResolvedValue({ code: "482913" });
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
      default_location: SWIETLICA_REF,
      default_capacity: 12,
    });
    renderStepper();
    await submitStep1();

    await screen.findByText("Pierwszy termin w grupie „Nutki”");
    expect(await screen.findByRole("combobox", { name: "Miejsce" })).toHaveDisplayValue("Świetlica na Polnej");
    expect(screen.getByLabelText("Ile miejsc")).toHaveValue("12");

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
      default_location: SWIETLICA_REF,
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

  it("a step-1 re-save keeps the step-2 place and capacity unless the group defaults changed", async () => {
    vi.mocked(groupsApi.createAdditionalMyCircle).mockResolvedValue({
      ...GROUP,
      default_location: SWIETLICA_REF,
      default_capacity: 12,
    });
    vi.mocked(groupsApi.updateGroup)
      .mockResolvedValueOnce({ ...GROUP, name: "Nutki II", default_location: SWIETLICA_REF, default_capacity: 12 })
      .mockResolvedValueOnce({ ...GROUP, name: "Nutki II", default_location: SWIETLICA_REF, default_capacity: 20 });
    renderStepper();
    await submitStep1();

    fireEvent.change(await screen.findByRole("combobox", { name: "Miejsce" }), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Ile miejsc"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "← Wstecz" }));
    fireEvent.change(screen.getByLabelText("Nazwa grupy"), { target: { value: "Nutki II" } });
    fireEvent.click(screen.getByRole("button", { name: "Dalej →" }));

    await screen.findByText("Pierwszy termin w grupie „Nutki II”");
    expect(groupsApi.updateGroup).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("combobox", { name: "Miejsce" })).toHaveValue("");
    expect(screen.getByLabelText("Ile miejsc")).toHaveValue("8");

    fireEvent.click(screen.getByRole("button", { name: "← Wstecz" }));
    fireEvent.change(screen.getByLabelText("Ile miejsc (opcjonalnie)"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Dalej →" }));

    await waitFor(() => expect(groupsApi.updateGroup).toHaveBeenCalledTimes(2));
    expect(await screen.findByLabelText("Ile miejsc")).toHaveValue("20");
    expect(screen.getByRole("combobox", { name: "Miejsce" })).toHaveValue("");
  });

  it("the done screen links to the term's public page and Gotowe finishes", async () => {
    const { onDone } = renderStepper();
    await submitStep1();
    await submitStep2();

    expect(await screen.findByText(PRIVATE_DONE)).toBeInTheDocument();
    expect(screen.queryByText(PUBLIC_DONE)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Przejdź do publicznej strony →" })).toHaveAttribute(
      "href",
      termPublicPath(GROUP, TERM.id),
    );
    fireEvent.click(screen.getByRole("button", { name: "Gotowe" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("the done screen of a PUBLIC group says anyone with the link sees the page", async () => {
    vi.mocked(groupsApi.createAdditionalMyCircle).mockResolvedValue({ ...GROUP, visibility: "PUBLIC" });
    renderStepper("studio-nutka");
    await submitStep1();
    await submitStep2();

    expect(await screen.findByText(PUBLIC_DONE)).toBeInTheDocument();
    expect(screen.queryByText(PRIVATE_DONE)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Przejdź do publicznej strony →" })).toBeInTheDocument();
  });

  it("the PRIVATE done screen shows the access code with both copy buttons", async () => {
    renderStepper();
    await submitStep1();
    await submitStep2();

    const card = await screen.findByRole("region", { name: "Kod dostępu" });
    expect(await within(card).findByText("482 913")).toBeInTheDocument();
    expect(groupsApi.getJoinCode).toHaveBeenCalledWith("g-1");
    expect(within(card).getByRole("button", { name: "Kopiuj kod" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Kopiuj link z kodem" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Wygeneruj nowy kod" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Przejdź do publicznej strony →" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gotowe" })).toBeInTheDocument();
  });

  it("the PUBLIC done screen shows no access code and never fetches one", async () => {
    vi.mocked(groupsApi.createAdditionalMyCircle).mockResolvedValue({ ...GROUP, visibility: "PUBLIC" });
    renderStepper("studio-nutka");
    await submitStep1();
    await submitStep2();

    expect(await screen.findByText(PUBLIC_DONE)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Kod dostępu" })).not.toBeInTheDocument();
    expect(groupsApi.getJoinCode).not.toHaveBeenCalled();
  });

  it("focuses the group name when the sheet opens", async () => {
    renderStepper();
    await waitFor(() => expect(screen.getByLabelText("Nazwa grupy")).toHaveFocus());
  });

  it("moves focus into the sheet on every step change", async () => {
    renderStepper();
    await submitStep1();

    await waitFor(() => expect(screen.getByLabelText("Data i godzina")).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "← Wstecz" }));
    await waitFor(() => expect(screen.getByLabelText("Nazwa grupy")).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Dalej →" }));
    await waitFor(() => expect(screen.getByLabelText("Data i godzina")).toHaveFocus());
    await submitStep2();
    await waitFor(() => expect(screen.getByText(PRIVATE_DONE)).toHaveFocus());
  });

  it.each(["0", "-1", "2.5", "10001", "-", "e", "1e3"])("rejects capacity %s inline and blocks both steps", async (raw) => {
    renderStepper();
    fireEvent.change(await screen.findByLabelText("Nazwa grupy"), { target: { value: "Nutki" } });
    await screen.findByRole("combobox", { name: "Stałe miejsce spotkań (opcjonalnie)" });

    const groupCapacity = screen.getByLabelText("Ile miejsc (opcjonalnie)");
    fireEvent.change(groupCapacity, { target: { value: raw } });
    expect(screen.getByRole("alert")).toHaveTextContent("Podaj liczbę od 1 do 10000");
    expect(groupCapacity).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Dalej →" })).toBeDisabled();

    fireEvent.change(groupCapacity, { target: { value: "" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dalej →" }));

    fireEvent.change(await screen.findByLabelText("Data i godzina"), { target: { value: "2026-10-24T17:00" } });
    fireEvent.change(screen.getByLabelText("Ile miejsc"), { target: { value: raw } });
    expect(screen.getByRole("alert")).toHaveTextContent("Podaj liczbę od 1 do 10000");
    expect(screen.getByRole("button", { name: "Dodaj" })).toBeDisabled();
    expect(termsApi.createTerm).not.toHaveBeenCalled();
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
