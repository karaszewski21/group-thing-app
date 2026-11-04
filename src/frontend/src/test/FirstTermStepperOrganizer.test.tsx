import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { getTestLocation, getTestRouter, renderWithRoute } from "./renderWithRoute";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as locationsApi from "../api/locations";
import type { LocationRefResponse } from "../api/locations";
import * as termsApi from "../api/terms";
import { ApiError } from "../api/client";
import { FirstTermStepperOrganizer } from "../features/terms/FirstTermStepperOrganizer";
import { FIRST_TERM_PICKER, useFirstTermStepper } from "../features/terms/hooks/useFirstTermStepper";
import { newTermDraft } from "../features/terms/termDraft";
import { LocationPicker } from "../components/shared/LocationPicker";
import { useAppNavigate } from "../routing/navigation";
import type { ModalKind, PickedLocationState } from "../utils/appHelpers";
import { makeLocality, makeLocationRef, makeLocationResponse } from "./fixtures/locations";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/terms", () => ({ createTerm: vi.fn() }));
vi.mock("../api/locations", () => ({
  getMyLocations: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  deleteLocation: vi.fn(),
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "tok" }) }));

const SWIETLICA = makeLocationResponse({
  formatted_address: "ul. Polna 12, 60-595 Poznań",
  locality: makeLocality({ id: "0969400", name: "Poznań", gmina: "Poznań", powiat: "Poznań", voivodeship: "wielkopolskie" }),
  label: "Poznań, wielkopolskie",
});
const KETY = makeLocationResponse({ id: "loc-2" });

const SWIETLICA_REF: LocationRefResponse = makeLocationRef({
  id: SWIETLICA.id,
  locality: SWIETLICA.locality,
  label: SWIETLICA.label,
  formatted_address: SWIETLICA.formatted_address,
});

/** The stepper alone, its draft held as the panel would hold it. */
function StandaloneStepper({
  onDone,
  defaultLocation = null,
  defaultCapacity = null,
}: {
  onDone: () => void;
  defaultLocation?: LocationRefResponse | null;
  defaultCapacity?: number | null;
}) {
  const [draft, setDraft] = useState(() => newTermDraft(defaultLocation, defaultCapacity));
  return (
    <FirstTermStepperOrganizer
      draft={draft}
      onDraftChange={setDraft}
      onClose={() => {}}
      onAddPlace={() => {}}
      circleGroupId="g-1"
      organizerSlug={null}
      onDone={onDone}
      defaultLocation={defaultLocation}
      defaultCapacity={defaultCapacity}
    />
  );
}

function renderStepper(
  onDone = vi.fn(),
  defaults: { defaultLocation?: LocationRefResponse | null; defaultCapacity?: number | null } = {},
) {
  renderWithRoute(<StandaloneStepper onDone={onDone} {...defaults} />, { url: "/", wrapper: createQueryWrapper() });
  return onDone;
}

function fillAndSubmit(description: string) {
  fireEvent.change(screen.getByLabelText("Data i godzina"), { target: { value: "2026-10-10T10:00" } });
  fireEvent.change(screen.getByLabelText("Opis (opcjonalnie)"), { target: { value: description } });
  fireEvent.click(screen.getByRole("button", { name: "Dodaj termin" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(locationsApi.getMyLocations).mockResolvedValue([SWIETLICA, KETY]);
});

describe("FirstTermStepperOrganizer — server error message", () => {
  it("shows the server's 400 moderation message in role=alert and keeps the form", async () => {
    const message = "Opis terminu narusza zasady społeczności. Zmień go i spróbuj ponownie.";
    vi.mocked(termsApi.createTerm).mockRejectedValue(
      new ApiError(400, "Bad Request", { status: 400, error: "Bad Request", message }),
    );
    const onDone = renderStepper(vi.fn(), { defaultLocation: SWIETLICA_REF });
    await screen.findByRole("combobox", { name: "Miejsce" });
    fillAndSubmit("zły opis");

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Opis (opcjonalnie)")).toHaveValue("zły opis");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("falls back to the generic Polish message for a non-domain error", async () => {
    vi.mocked(termsApi.createTerm).mockRejectedValue(new ApiError(500, "Server Error", null));
    renderStepper();
    fireEvent.change(await screen.findByRole("combobox", { name: "Miejsce" }), { target: { value: KETY.id } });
    fillAndSubmit("opis");

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się dodać terminu — spróbuj ponownie");
  });
});

describe("FirstTermStepperOrganizer — place and capacity", () => {
  it("createTerm_prefilledGroupDefaults_sendsLocationAndCapacity", async () => {
    vi.mocked(termsApi.createTerm).mockResolvedValue({ id: "t-1" } as termsApi.TermResponse);
    renderStepper(vi.fn(), { defaultLocation: SWIETLICA_REF, defaultCapacity: 12 });

    expect(await screen.findByRole("combobox", { name: "Miejsce" })).toHaveDisplayValue("Poznań, wielkopolskie");
    expect(screen.getByLabelText("Ile miejsc")).toHaveValue("12");
    fillAndSubmit("opis");

    expect(await screen.findByRole("button", { name: "Gotowe" })).toBeInTheDocument();
    expect(termsApi.createTerm).toHaveBeenCalledWith({
      circle_group_id: "g-1",
      occurs_on: "2026-10-10T10:00",
      description: "opis",
      location_id: "loc-1",
      capacity: 12,
    });
  });

  it("createTerm_clearedPrefilledCapacity_sendsExplicitNull", async () => {
    vi.mocked(termsApi.createTerm).mockResolvedValue({ id: "t-1" } as termsApi.TermResponse);
    renderStepper(vi.fn(), { defaultLocation: SWIETLICA_REF, defaultCapacity: 12 });

    expect(await screen.findByRole("combobox", { name: "Miejsce" })).toHaveDisplayValue("Poznań, wielkopolskie");
    fireEvent.change(screen.getByLabelText("Ile miejsc"), { target: { value: "" } });
    fillAndSubmit("opis");

    expect(await screen.findByRole("button", { name: "Gotowe" })).toBeInTheDocument();
    expect(termsApi.createTerm).toHaveBeenCalledWith({
      circle_group_id: "g-1",
      occurs_on: "2026-10-10T10:00",
      description: "opis",
      location_id: "loc-1",
      capacity: null,
    });
  });

  it("createTerm_noPlace_blocksSubmitUntilPicked", async () => {
    vi.mocked(termsApi.createTerm).mockResolvedValue({ id: "t-1" } as termsApi.TermResponse);
    renderStepper();

    const select = await screen.findByRole("combobox", { name: "Miejsce" });
    expect(within(select).queryByRole("option", { name: "Brak miejsca" })).not.toBeInTheDocument();
    fillAndSubmit("opis");
    expect(screen.getByRole("button", { name: "Dodaj termin" })).toBeDisabled();
    expect(termsApi.createTerm).not.toHaveBeenCalled();

    fireEvent.change(select, { target: { value: KETY.id } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj termin" }));

    expect(await screen.findByRole("button", { name: "Gotowe" })).toBeInTheDocument();
    expect(termsApi.createTerm).toHaveBeenCalledWith({
      circle_group_id: "g-1",
      occurs_on: "2026-10-10T10:00",
      description: "opis",
      location_id: KETY.id,
    });
  });

  it.each(["0", "-1", "2.5", "10001"])("createTerm_invalidCapacity_%s_showsInlineErrorAndBlocksSubmit", async (raw) => {
    renderStepper();

    await screen.findByRole("combobox", { name: "Miejsce" });
    fireEvent.change(screen.getByLabelText("Ile miejsc"), { target: { value: raw } });
    fillAndSubmit("opis");

    expect(screen.getByRole("alert")).toHaveTextContent("Podaj liczbę od 1 do 10000");
    expect(screen.getByRole("button", { name: "Dodaj termin" })).toBeDisabled();
    expect(termsApi.createTerm).not.toHaveBeenCalled();
  });
});

/* ---------- the panel's draft lifecycle across /places/new ---------- */

/** The panel above the pages: the stepper modal and its draft outlive the
 * page swap to /places/new, as AppDataContext + AppModals do. The defaults
 * are a new object on every render, as after each panel reload of the groups. */
function PanelStandIn({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<ModalKind>(null);
  const stepper = useFirstTermStepper(setModal, newTermDraft(null, null));
  return (
    <>
      {children}
      <button type="button" onClick={stepper.openStepper}>
        Otwórz kreator
      </button>
      {modal === "pierwszy-termin" && (
        <FirstTermStepperOrganizer
          draft={stepper.firstTermDraft}
          onDraftChange={stepper.setFirstTermDraft}
          onClose={stepper.closeStepper}
          onAddPlace={stepper.closeStepperForPlace}
          circleGroupId="g-1"
          organizerSlug={null}
          onDone={stepper.closeStepper}
        />
      )}
    </>
  );
}

/** `/places/new` standing in for PlaceCreateView: both buttons go back,
 * replacing this entry, with the pick (or `null` for a cancel). */
function PlaceCreateProbe() {
  const navigate = useAppNavigate();
  const back = (locationId: string | null) => {
    const state: PickedLocationState = { pickedLocation: { picker: FIRST_TERM_PICKER, locationId } };
    navigate("/", { replace: true, state });
  };
  return (
    <>
      <button type="button" onClick={() => back(KETY.id)}>
        Zapisz miejsce
      </button>
      <button type="button" onClick={() => back(null)}>
        Anuluj miejsce
      </button>
    </>
  );
}

function renderPanel() {
  const QueryWrapper = createQueryWrapper();
  return renderWithRoute(<p>Start</p>, {
    url: "/",
    pattern: "/",
    routes: { "/places/new": <PlaceCreateProbe /> },
    wrapper: ({ children }) => (
      <QueryWrapper>
        <PanelStandIn>{children}</PanelStandIn>
      </QueryWrapper>
    ),
  });
}

async function openTypeAndAddPlace() {
  fireEvent.click(screen.getByRole("button", { name: "Otwórz kreator" }));
  fireEvent.change(screen.getByLabelText("Opis (opcjonalnie)"), { target: { value: "Piknik" } });
  await screen.findByRole("combobox", { name: "Miejsce" });
  fireEvent.click(screen.getByRole("link", { name: "Dodaj nowe miejsce" }));
  expect(screen.queryByRole("dialog", { name: "Dodaj pierwszy termin" })).not.toBeInTheDocument();
  expect(getTestLocation().pathname).toBe("/places/new");
}

describe("FirstTermStepperOrganizer — trip to /places/new", () => {
  it("plus_thenSavedPlace_reopensStepperWithDraftAndNewPlace", async () => {
    renderPanel();
    await openTypeAndAddPlace();

    fireEvent.click(screen.getByRole("button", { name: "Zapisz miejsce" }));

    expect(await screen.findByRole("dialog", { name: "Dodaj pierwszy termin" })).toBeInTheDocument();
    expect(screen.getByLabelText("Opis (opcjonalnie)")).toHaveValue("Piknik");
    expect(await screen.findByRole("combobox", { name: "Miejsce" })).toHaveValue(KETY.id);
    expect(getTestLocation().pathname).toBe("/");
    expect(getTestRouter().calls.map((call) => call.method)).toEqual(["replace", "replace"]);
  });

  it("plus_thenCancel_reopensStepperWithDraftAndPlaceUnchanged", async () => {
    renderPanel();
    await openTypeAndAddPlace();

    fireEvent.click(screen.getByRole("button", { name: "Anuluj miejsce" }));

    expect(await screen.findByRole("dialog", { name: "Dodaj pierwszy termin" })).toBeInTheDocument();
    expect(screen.getByLabelText("Opis (opcjonalnie)")).toHaveValue("Piknik");
    expect(await screen.findByRole("combobox", { name: "Miejsce" })).toHaveValue("");
  });

  it("close_afterReopen_staysClosedOnRerenderAndDropsDraft", async () => {
    const { rerender } = renderPanel();
    await openTypeAndAddPlace();
    fireEvent.click(screen.getByRole("button", { name: "Zapisz miejsce" }));
    await screen.findByRole("dialog", { name: "Dodaj pierwszy termin" });

    fireEvent.click(screen.getByRole("button", { name: "Zamknij" }));
    rerender(<p>Start</p>);
    await act(async () => {});

    expect(screen.queryByRole("dialog", { name: "Dodaj pierwszy termin" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Otwórz kreator" }));
    expect(screen.getByLabelText("Opis (opcjonalnie)")).toHaveValue("");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Miejsce" })).toHaveValue(""));
  });
});

/* ---------- a page's picker that mounts after the panel has read the state ---------- */

const LATE_PICKER = "late-host";

/** A host that shows its form only later (as after a loading state), so its
 * picker reads the handed-back state after the panel's first commit. */
function LateHost() {
  const [ready, setReady] = useState(false);
  const [locationId, setLocationId] = useState<string | null>(null);
  if (!ready) {
    return (
      <button type="button" onClick={() => setReady(true)}>
        Pokaż formularz
      </button>
    );
  }
  return <LocationPicker value={locationId} onChange={setLocationId} label="Miejsce hosta" idPrefix={LATE_PICKER} />;
}

function BackToLateHost() {
  const navigate = useAppNavigate();
  const state: PickedLocationState = { pickedLocation: { picker: LATE_PICKER, locationId: KETY.id } };
  return (
    <button type="button" onClick={() => navigate("/late", { replace: true, state })}>
      Wróć z miejscem
    </button>
  );
}

describe("FirstTermStepperOrganizer — panel reader and page pickers", () => {
  it("lateMountingPicker_afterPanelRead_stillReceivesPick", async () => {
    const QueryWrapper = createQueryWrapper();
    renderWithRoute(<BackToLateHost />, {
      url: "/places/new",
      pattern: "/places/new",
      routes: { "/late": <LateHost /> },
      wrapper: ({ children }) => (
        <QueryWrapper>
          <PanelStandIn>{children}</PanelStandIn>
        </QueryWrapper>
      ),
    });

    fireEvent.click(screen.getByRole("button", { name: "Wróć z miejscem" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pokaż formularz" }));

    expect(await screen.findByRole("combobox", { name: "Miejsce hosta" })).toHaveValue(KETY.id);
    expect(screen.queryByRole("dialog", { name: "Dodaj pierwszy termin" })).not.toBeInTheDocument();
  });
});
