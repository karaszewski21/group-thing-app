import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { getTestLocation, renderWithRoute } from "./renderWithRoute";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as locationsApi from "../api/locations";
import type { LocationRefResponse, LocationResponse } from "../api/locations";
import * as termsApi from "../api/terms";
import { TermEditForm } from "../features/terms/TermEditForm";
import { TermEditView } from "../features/terms/TermEditView";
import { termEditDraftFrom } from "../features/terms/termDraft";
import { makeLocality, makeLocationResponse } from "./fixtures/locations";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/terms", () => ({
  createNeededItem: vi.fn(),
  deleteNeededItem: vi.fn(),
  updateNeededItem: vi.fn(),
  updateTerm: vi.fn(),
  getTerm: vi.fn(),
}));
vi.mock("../api/locations", () => ({
  getMyLocations: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  deleteLocation: vi.fn(),
}));
/** A stand-in for the panel's AppDataContext: `termEdit` lives outside the
 * page, so it survives the page's unmount. */
const panel = vi.hoisted(() => {
  let state: Record<string, unknown> = {};
  const listeners = new Set<() => void>();
  return {
    reset(initial: Record<string, unknown>) {
      state = initial;
    },
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setters: {
      setTermEdit: (next: unknown) => {
        state = { ...state, termEdit: next };
        listeners.forEach((listener) => listener());
      },
    },
  };
});

vi.mock("../features/panel/appDataStore", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useAppData: () => ({ ...useSyncExternalStore(panel.subscribe, panel.get), ...panel.setters }),
  };
});

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "tok" }) }));

const salaNr2: LocationResponse = makeLocationResponse({
  id: "loc-2",
  locality: makeLocality({ id: "0969400", name: "Poznań", gmina: "Poznań", powiat: "Poznań", voivodeship: "wielkopolskie" }),
  label: "Poznań, wielkopolskie",
  formatted_address: "ul. Szkolna 2, Poznań",
});

const groupDefault: LocationResponse = makeLocationResponse({ id: "loc-9" });

/** The nested group/term view of a saved place. */
function locationRef({ id, locality, label, formatted_address, google_place_id, deleted_at }: LocationResponse): LocationRefResponse {
  return { id, locality, label, formatted_address, google_place_id, deleted_at };
}

const term: termsApi.TermResponse = {
  id: "t1",
  group_id: "g1",
  occurs_on: "2026-10-14T17:00:00",
  description: "Park Sołacki",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  attendee_count: 0,
  child_count: 0,
  location: locationRef(salaNr2),
  capacity: 10,
};

const neededItem: termsApi.NeededItemResponse = {
  id: "ni1",
  term_id: "t1",
  name: "Rower",
  description: null,
  claimed: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

/** The form with its draft held as `TermEditView` holds it. */
function FormWithDraft(props: Omit<ComponentProps<typeof TermEditForm>, "draft" | "onDraftChange">) {
  const [draft, setDraft] = useState(() => termEditDraftFrom(props.term));
  return <TermEditForm {...props} draft={draft} onDraftChange={setDraft} />;
}

function renderForm(shownTerm: termsApi.TermResponse = term, onChanged = vi.fn(), onDone = vi.fn()) {
  return renderWithRoute(
    <FormWithDraft
      term={shownTerm}
      neededItems={[neededItem]}
      onChanged={onChanged}
      onDone={onDone}
    />,
    { url: "/", wrapper: createQueryWrapper() },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(locationsApi.getMyLocations).mockResolvedValue([salaNr2, groupDefault]);
});

describe("TermEditForm — server error surfacing", () => {
  it("saveEdit_rejectedName_showsItemsErrorAndKeepsRowEditorOpen", async () => {
    const rejection = "Nazwa rzeczy narusza zasady społeczności. Zmień ją i spróbuj ponownie.";
    vi.mocked(termsApi.updateNeededItem).mockRejectedValue(
      new ApiError(400, "Bad Request", { message: rejection }),
    );
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Edytuj potrzebną rzecz" }));
    fireEvent.change(screen.getByLabelText("Nazwa rzeczy"), { target: { value: "Zła nazwa" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Zapisz" })[1]);

    expect(await screen.findByRole("alert")).toHaveTextContent(rejection);
    expect(screen.getByLabelText("Nazwa rzeczy")).toHaveValue("Zła nazwa");
    expect(termsApi.updateNeededItem).toHaveBeenCalledWith("ni1", { name: "Zła nazwa", description: "" });
  });

  it("updateTerm_rejectedDescription_showsFormErrorAlert", async () => {
    const rejection = "Opis terminu narusza zasady społeczności. Zmień go i spróbuj ponownie.";
    vi.mocked(termsApi.updateTerm).mockRejectedValue(
      new ApiError(400, "Bad Request", { message: rejection }),
    );
    renderForm();

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
    renderForm();

    fireEvent.change(screen.getByLabelText("Opis"), { target: { value: "Nowy opis" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Zapisz" })[0]);

    expect(await screen.findByRole("alert")).toHaveTextContent(unavailable);
  });
});

describe("TermEditForm — needed items as plain names", () => {
  it("render_listsNamesWithDangerRemove_andNoCategoryField", async () => {
    renderForm();
    await screen.findByRole("combobox", { name: "Miejsce" });

    expect(screen.getByText("Potrzebne rzeczy")).toBeInTheDocument();
    expect(screen.getByText("Rower")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usuń potrzebną rzecz" })).toHaveClass("text-danger");
    fireEvent.click(screen.getByRole("button", { name: "Dodaj potrzebną rzecz" }));
    expect(screen.getByLabelText("Nazwa nowej rzeczy")).toHaveAttribute("placeholder", "np. Termos");
    expect(screen.queryByLabelText(/^Typ/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });

  it("addItem_sendsTermIdNameAndDescription", async () => {
    vi.mocked(termsApi.createNeededItem).mockResolvedValue(neededItem);
    const onChanged = vi.fn();
    renderForm(term, onChanged);

    fireEvent.click(screen.getByRole("button", { name: "Dodaj potrzebną rzecz" }));
    fireEvent.change(screen.getByLabelText("Nazwa nowej rzeczy"), { target: { value: "  Termos " } });
    fireEvent.change(screen.getByLabelText("Doprecyzowanie nowej rzeczy"), { target: { value: "1 l" } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(termsApi.createNeededItem).toHaveBeenCalledWith({ term_id: "t1", name: "Termos", description: "1 l" });
  });

  it("saveEdit_unchangedName_sendsOnlyDescription", async () => {
    vi.mocked(termsApi.updateNeededItem).mockResolvedValue(neededItem);
    const onChanged = vi.fn();
    renderForm(term, onChanged);

    fireEvent.click(screen.getByRole("button", { name: "Edytuj potrzebną rzecz" }));
    fireEvent.change(screen.getByLabelText("Doprecyzowanie rzeczy"), { target: { value: "dla 3-latka" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Zapisz" })[1]);

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(termsApi.updateNeededItem).toHaveBeenCalledWith("ni1", { description: "dla 3-latka" });
  });
});

describe("TermEditForm — place and capacity", () => {
  it("render_noStandingMembersSection", async () => {
    renderForm();

    expect(await screen.findByLabelText("Miejsce")).toBeInTheDocument();
    expect(screen.queryByText("Formalizuj stałych członków")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ustal stałych członków" })).not.toBeInTheDocument();
  });

  it("initialState_showsTermValuesNotGroupDefaults", async () => {
    renderForm();

    const select = await screen.findByRole("combobox", { name: "Miejsce" });
    expect(select).toHaveValue("loc-2");
    expect(select).toHaveDisplayValue("Poznań, wielkopolskie");
    expect(within(select).getByRole("option", { name: "Kęty, małopolskie" })).toBeInTheDocument();
    expect(screen.getByLabelText("Ile miejsc")).toHaveValue("10");
  });

  it("placePicker_offersNoEmptyChoice", async () => {
    renderForm();

    const select = await screen.findByRole("combobox", { name: "Miejsce" });
    expect(within(select).queryByRole("option", { name: "Brak miejsca" })).not.toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Wybierz miejsce" })).toBeDisabled();
  });

  it("saveTermFields_termWithoutPlace_blocksSaveUntilPicked", async () => {
    vi.mocked(termsApi.updateTerm).mockResolvedValue(term);
    const onDone = vi.fn();
    renderForm({ ...term, location: null }, vi.fn(), onDone);

    const select = await screen.findByRole("combobox", { name: "Miejsce" });
    expect(select).toHaveAttribute("aria-invalid", "true");
    const save = screen.getAllByRole("button", { name: "Zapisz" })[0];
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(termsApi.updateTerm).not.toHaveBeenCalled();

    fireEvent.change(select, { target: { value: "loc-9" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    expect(termsApi.updateTerm).toHaveBeenCalledWith("t1", { location_id: "loc-9" });
  });

  it("saveTermFields_changedCapacity_sendsOnlyCapacity", async () => {
    vi.mocked(termsApi.updateTerm).mockResolvedValue(term);
    const onDone = vi.fn();
    renderForm(term, vi.fn(), onDone);

    expect(await screen.findByRole("combobox", { name: "Miejsce" })).toHaveValue("loc-2");
    fireEvent.change(screen.getByLabelText("Ile miejsc"), { target: { value: "8" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Zapisz" })[0]);

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    expect(termsApi.updateTerm).toHaveBeenCalledWith("t1", { capacity: 8 });
  });

  it.each(["0", "-1", "2.5", "10001"])("saveTermFields_invalidCapacity_%s_showsInlineErrorAndBlocksSave", async (raw) => {
    renderForm();

    await screen.findByRole("combobox", { name: "Miejsce" });
    fireEvent.change(screen.getByLabelText("Ile miejsc"), { target: { value: raw } });

    expect(screen.getByRole("alert")).toHaveTextContent("Podaj liczbę od 1 do 10000");
    const save = screen.getAllByRole("button", { name: "Zapisz" })[0];
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(termsApi.updateTerm).not.toHaveBeenCalled();
  });

  it("deletedTermLocation_rendersUsunieteRow", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([groupDefault]);
    renderForm({ ...term, location: { ...locationRef(salaNr2), deleted_at: "2026-10-10T10:00:00Z" } });

    const select = await screen.findByRole("combobox", { name: "Miejsce" });
    expect(select).toHaveValue("loc-2");
    expect(select).toHaveDisplayValue("Poznań, wielkopolskie (usunięte)");
  });
});

describe("TermEditView — draft in the panel", () => {
  const EDIT_URL = "/terms/t1/edit";

  function renderEditPage() {
    return renderWithRoute(<TermEditView />, {
      url: EDIT_URL,
      pattern: "/terms/:termId/edit",
      routes: { "/meetings": <p>Spotkania</p> },
      wrapper: createQueryWrapper(),
    });
  }

  beforeEach(() => {
    vi.mocked(termsApi.getTerm).mockResolvedValue(term);
    panel.reset({
      myGroups: [{ id: "g1" }],
      termEdit: null,
      load: vi.fn(),
      showToast: vi.fn(),
    });
  });

  it("draft_survivesRemount_andPickerHasNoInlineForm", async () => {
    const { unmount } = renderEditPage();
    fireEvent.change(await screen.findByLabelText("Opis"), { target: { value: "Nowy opis" } });

    const plus = screen.getByRole("link", { name: "Dodaj nowe miejsce" });
    expect(plus.getAttribute("href")).toMatch(/^\/places\/new\?/);
    expect(screen.queryByLabelText("Nazwa miejsca")).not.toBeInTheDocument();
    unmount();
    renderEditPage();

    expect(await screen.findByLabelText("Opis")).toHaveValue("Nowy opis");
    expect(await screen.findByRole("combobox", { name: "Miejsce" })).toHaveValue("loc-2");
  });

  it("save_clearsDraftBeforeGoingToMeetings", async () => {
    vi.mocked(termsApi.updateTerm).mockResolvedValue(term);
    renderEditPage();
    await screen.findByRole("combobox", { name: "Miejsce" });
    fireEvent.change(screen.getByLabelText("Ile miejsc"), { target: { value: "8" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Zapisz" })[0]);

    await waitFor(() => expect(getTestLocation().pathname).toBe("/meetings"));
    expect(termsApi.updateTerm).toHaveBeenCalledWith("t1", { capacity: 8 });
    expect(panel.get().termEdit).toBeNull();
  });

  it("cancel_clearsDraftWithoutSaving", async () => {
    renderEditPage();
    fireEvent.change(await screen.findByLabelText("Opis"), { target: { value: "Porzucony" } });
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));

    await waitFor(() => expect(getTestLocation().pathname).toBe("/meetings"));
    expect(termsApi.updateTerm).not.toHaveBeenCalled();
    expect(panel.get().termEdit).toBeNull();
  });
});
