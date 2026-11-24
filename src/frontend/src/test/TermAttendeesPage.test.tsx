import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TermAttendeesPage } from "../features/meetings/TermAttendeesPage";
import * as termsApi from "../api/terms";
import * as groupsApi from "../api/groups";
import { ApiError } from "../api/client";
import type { TermResponse } from "../api/terms";
import type { GroupResponse, TermAttendanceResponse, TermAttendeeResponse } from "../api/groups";
import dayjs from "../utils/dayjs";
import { createQueryWrapper } from "./queryClient";
import { renderWithRoute } from "./renderWithRoute";

vi.mock("../api/terms", () => ({
  getTerm: vi.fn(),
}));

vi.mock("../api/groups", () => ({
  getGroup: vi.fn(),
  getTermAttendees: vi.fn(),
  getTermAttendance: vi.fn(),
  setPresence: vi.fn(),
  setPaymentStatus: vi.fn(),
  closeAttendance: vi.fn(),
}));

const conversationHook = vi.hoisted(() => ({ openConversation: vi.fn() }));
vi.mock("../hooks/useOpenConversation", () => ({ useOpenConversation: () => conversationHook }));

const TERM_ID = "3f2b8c1e-7a4d-4e9b-9c1a-2d5e6f7a8b9c";
const GROUP_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

const term: TermResponse = {
  id: TERM_ID,
  group_id: GROUP_ID,
  occurs_on: "2026-10-12T17:00:00",
  description: "Zabawy sensoryczne",
  created_at: "2026-09-01T10:00:00",
  updated_at: "2026-09-01T10:00:00",
  attendee_count: 3,
  child_count: 3,
  price: null,
  payment_url: null,
  payment_method: null,
};

const group: GroupResponse = {
  id: GROUP_ID,
  party_id: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
  name: "Krąg Maluchy",
  description: null,
  organizer_slug: "maluchy",
  layout_mode: "CIRCLE",
  visibility: "PUBLIC",
  created_at: "2026-09-01T10:00:00",
  updated_at: "2026-09-01T10:00:00",
  default_price: null,
  default_payment_url: null,
  default_payment_method: null,
};

const thisYear = dayjs().year();

function attendee(overrides: Partial<TermAttendeeResponse>): TermAttendeeResponse {
  return {
    party_id: "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f",
    display_name: "Anna Nowak",
    child_count: 0,
    family_id: null,
    family_name: null,
    children: [],
    present: false,
    is_organizer: false,
    payment_status: "UNPAID",
    withdrawn: false,
    counted: true,
    ...overrides,
  };
}

function attendanceRead(overrides: Partial<TermAttendanceResponse> = {}): TermAttendanceResponse {
  return {
    state: "OPEN",
    attendance_points: 20,
    allowed_levels: [0, 10, 20],
    attendee_count: 3,
    present_count: 1,
    min_present: 3,
    auto_close_on: "2026-10-19T17:00:00",
    closed_at: null,
    rewarded: null,
    ...overrides,
  };
}

const attendees: TermAttendeeResponse[] = [
  attendee({
    party_id: "11111111-1111-4111-8111-111111111111",
    display_name: "Anna Nowak",
    family_name: "Rodzina Nowak",
    child_count: 2,
    children: [{ birth_year: thisYear - 8 }, { birth_year: thisYear - 5 }],
  }),
  attendee({
    party_id: "22222222-2222-4222-8222-222222222222",
    display_name: "Marek Wiśniewski",
    family_name: "Rodzina Wiśniewskich",
    child_count: 1,
    children: [{ birth_year: thisYear - 3 }, { birth_year: null }],
  }),
  attendee({
    party_id: "33333333-3333-4333-8333-333333333333",
    display_name: "Ola Zielińska",
    child_count: 0,
    children: [],
  }),
];

function renderPage() {
  return renderWithRoute(<TermAttendeesPage />, {
    url: `/terms/${TERM_ID}/attendees`,
    pattern: "/terms/:termId/attendees",
    routes: { "/messages/:id": <p>Wątek rozmowy</p> },
    wrapper: createQueryWrapper(),
  });
}

describe("TermAttendeesPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(termsApi.getTerm).mockResolvedValue(term);
    vi.mocked(groupsApi.getGroup).mockResolvedValue(group);
    vi.mocked(groupsApi.getTermAttendees).mockResolvedValue(attendees);
    vi.mocked(groupsApi.getTermAttendance).mockResolvedValue(attendanceRead());
  });

  it("rows render name, family, pill wording and ages", async () => {
    renderPage();

    expect(await screen.findByText("Anna Nowak")).toBeInTheDocument();
    expect(screen.getByText("Rodzina Nowak")).toBeInTheDocument();
    expect(screen.getByText("przychodzi z 2 dzieci")).toBeInTheDocument();
    expect(screen.getByText("dzieci w rodzinie: 5, 8 lat")).toBeInTheDocument();

    expect(screen.getByText("Marek Wiśniewski")).toBeInTheDocument();
    expect(screen.getByText("przychodzi z 1 dzieckiem")).toBeInTheDocument();
    expect(screen.getByText("dzieci w rodzinie: 3 lata, wiek nieznany")).toBeInTheDocument();

    expect(screen.getByText("Ola Zielińska")).toBeInTheDocument();
    expect(screen.getByText("przychodzi bez dzieci")).toBeInTheDocument();
    expect(screen.getByText("brak dzieci w profilu rodziny")).toBeInTheDocument();

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("link", { name: /Zobacz stronę terminu/ })).toHaveAttribute(
      "href",
      `/maluchy/group/${GROUP_ID}/term/${TERM_ID}`,
    );
  });

  it("summary and empty state", async () => {
    const { unmount } = renderPage();
    expect(await screen.findByText("3 zapisy · 3 dzieci")).toBeInTheDocument();
    unmount();

    vi.mocked(groupsApi.getTermAttendees).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("Brak zapisów")).toBeInTheDocument();
    expect(screen.getByText("Nikt jeszcze nie zapisał się na ten termin.")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("ids pass through uncoerced", async () => {
    renderPage();
    await screen.findByText("Anna Nowak");

    expect(termsApi.getTerm).toHaveBeenCalledWith(TERM_ID);
    expect(groupsApi.getGroup).toHaveBeenCalledWith(GROUP_ID);
    expect(groupsApi.getTermAttendees).toHaveBeenCalledWith(GROUP_ID, TERM_ID);
  });

  it("attendees 403 shows denied", async () => {
    vi.mocked(groupsApi.getTermAttendees).mockRejectedValue(
      new ApiError(403, "Forbidden", null),
    );
    renderPage();

    expect(await screen.findByText("Nie masz dostępu do tego terminu.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Spróbuj ponownie" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Zobacz stronę terminu/)).not.toBeInTheDocument();
  });

  it("unknown term 404 shows notFound and never loads dependents", async () => {
    vi.mocked(termsApi.getTerm).mockRejectedValue(new ApiError(404, "Not Found", null));
    renderPage();

    expect(await screen.findByText("Nie znaleziono tego terminu.")).toBeInTheDocument();
    expect(screen.queryByText("Wczytywanie zapisanych…")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Spróbuj ponownie" })).not.toBeInTheDocument();
    expect(groupsApi.getGroup).not.toHaveBeenCalled();
    expect(groupsApi.getTermAttendees).not.toHaveBeenCalled();
  });

  it("getGroup 500 shows error with retry and minimal header", async () => {
    vi.mocked(groupsApi.getGroup).mockRejectedValue(
      new ApiError(500, "Internal Server Error", null),
    );
    renderPage();

    expect(await screen.findByRole("button", { name: "Spróbuj ponownie" })).toBeInTheDocument();
    expect(screen.queryByText("Krąg Maluchy")).not.toBeInTheDocument();
    expect(screen.queryByText(/Zobacz stronę terminu/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+ zapis|^Brak zapisów$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("generic attendees error retry refetches", async () => {
    vi.mocked(groupsApi.getTermAttendees)
      .mockRejectedValueOnce(new ApiError(500, "Internal Server Error", null))
      .mockResolvedValue(attendees);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Spróbuj ponownie" }));

    await waitFor(() =>
      expect(groupsApi.getTermAttendees).toHaveBeenCalledTimes(2),
    );
    expect(await screen.findByText("Anna Nowak")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Spróbuj ponownie" })).not.toBeInTheDocument();
  });

  it("a family whose children all lack a birth year shows only 'wiek nieznany'", async () => {
    vi.mocked(groupsApi.getTermAttendees).mockResolvedValue([
      attendee({
        display_name: "Ewa Lis",
        family_name: "Rodzina Lisów",
        child_count: 2,
        children: [{ birth_year: null }, { birth_year: null }],
      }),
    ]);
    renderPage();

    expect(await screen.findByText("Ewa Lis")).toBeInTheDocument();
    expect(screen.getByText("dzieci w rodzinie: wiek nieznany")).toBeInTheDocument();
    expect(screen.queryByText(/brak dzieci w profilu rodziny/)).not.toBeInTheDocument();
  });
  it("'Napisz do uczestników' opens the term conversation; a failure shows inline", async () => {
    conversationHook.openConversation
      .mockRejectedValueOnce(new Error("Nie udało się otworzyć rozmowy — spróbuj ponownie"))
      .mockResolvedValue("conv-5");
    renderPage();

    const button = await screen.findByRole("button", { name: "Napisz do uczestników" });
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się otworzyć rozmowy — spróbuj ponownie");

    fireEvent.click(button);
    expect(await screen.findByText("Wątek rozmowy")).toBeInTheDocument();
    expect(conversationHook.openConversation).toHaveBeenCalledWith({ kind: "TERM", id: TERM_ID });
  });
});

describe("TermAttendeesPage — attendance", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T18:00:00"));
    vi.mocked(termsApi.getTerm).mockResolvedValue(term);
    vi.mocked(groupsApi.getGroup).mockResolvedValue(group);
    vi.mocked(groupsApi.getTermAttendees).mockResolvedValue(attendees);
    vi.mocked(groupsApi.getTermAttendance).mockResolvedValue(attendanceRead());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("open_tickingABox_putsPresentAndDisablesTheBoxWhilePending", async () => {
    let finish: () => void = () => {};
    vi.mocked(groupsApi.setPresence).mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Zapisani na termin" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Ten termin daje 20 pkt za obecność. Punkty naliczą się, gdy obecne będą min. 3 osoby. Teraz: 1 z 3.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Bez zatwierdzenia lista zamknie się automatycznie 19 października."),
    ).toBeInTheDocument();

    const box = screen.getByRole("checkbox", { name: "Marek Wiśniewski" });
    expect(box).not.toBeChecked();
    expect(box).toBeEnabled();
    fireEvent.click(box);

    await waitFor(() => expect(box).toBeDisabled());
    expect(groupsApi.setPresence).toHaveBeenCalledWith(
      GROUP_ID,
      TERM_ID,
      "22222222-2222-4222-8222-222222222222",
      true,
    );
    finish();
    await waitFor(() => expect(box).toBeEnabled());
  });

  it("close_confirmDialog_postsTheClose", async () => {
    vi.mocked(groupsApi.closeAttendance).mockResolvedValue(
      attendanceRead({ state: "CLOSED", closed_at: "2026-10-12T19:00:00", auto_close_on: null, rewarded: false }),
    );
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Zatwierdź obecność" }));
    const dialog = screen.getByRole("alertdialog");
    expect(
      within(dialog).getByText(
        "Obecnych: 1. Za mało obecnych (1 z min. 3) — punkty nie zostaną naliczone. Po zatwierdzeniu nie zmienisz już listy obecnych ani punktów za obecność.",
      ),
    ).toBeInTheDocument();
    expect(groupsApi.closeAttendance).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Zatwierdź" }));

    await waitFor(() => expect(groupsApi.closeAttendance).toHaveBeenCalledWith(GROUP_ID, TERM_ID));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("open_organizerRow_isLabelledAndLeftOutOfTheCount", async () => {
    vi.mocked(groupsApi.getTermAttendees).mockResolvedValue(
      attendees.map((a, i) => ({ ...a, is_organizer: i === 0 })),
    );
    vi.mocked(groupsApi.getTermAttendance).mockResolvedValue(
      attendanceRead({ present_count: 1, min_present: 1 }),
    );
    renderPage();

    expect(
      await screen.findByText("organizator — nie dostaje punktów i nie liczy się do minimum"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `Ten termin daje 20 pkt za obecność. Punkty naliczą się, gdy obecne będą min. 1 osoba. Teraz: 1 z ${attendees.length - 1}.`,
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zatwierdź obecność" }));
    expect(
      within(screen.getByRole("alertdialog")).getByText(
        "Obecnych: 1. Po zatwierdzeniu nie zmienisz już listy obecnych ani punktów za obecność.",
      ),
    ).toBeInTheDocument();
  });

  it("notStarted_showsDisabledBoxesAndNoCloseButton", async () => {
    vi.mocked(groupsApi.getTermAttendance).mockResolvedValue(attendanceRead({ state: "NOT_STARTED" }));
    renderPage();

    expect(await screen.findByRole("checkbox", { name: "Anna Nowak" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Zatwierdź obecność" })).not.toBeInTheDocument();
  });

  it("closed_rendersTheRewardedAndBelowMinimumBanners", async () => {
    const frozen = attendees.map((a, i) => ({ ...a, present: i < 2 }));
    vi.mocked(groupsApi.getTermAttendees).mockResolvedValue(frozen);
    vi.mocked(groupsApi.getTermAttendance).mockResolvedValue(
      attendanceRead({
        state: "CLOSED",
        present_count: 3,
        closed_at: "2026-10-12T19:00:00",
        auto_close_on: null,
        rewarded: true,
      }),
    );
    const { unmount } = renderPage();

    expect(
      await screen.findByText(
        "Obecność zatwierdzona 12 października. Obecnych: 3. Każda z tych osób otrzymała do 20 pkt (w granicach miesięcznego limitu).",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Anna Nowak" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Anna Nowak" })).toBeDisabled();
    expect(screen.getAllByText("obecny")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Zatwierdź obecność" })).not.toBeInTheDocument();
    unmount();

    vi.mocked(groupsApi.getTermAttendance).mockResolvedValue(
      attendanceRead({
        state: "CLOSED",
        present_count: 2,
        closed_at: "2026-10-12T19:00:00",
        auto_close_on: null,
        rewarded: false,
      }),
    );
    renderPage();

    expect(
      await screen.findByText(
        "Obecność zatwierdzona. Za mało obecnych osób (2 z min. 3), punkty nie zostały naliczone.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Ola Zielińska" })).not.toBeChecked();
  });
});

describe("TermAttendeesPage — payment", () => {
  const pricedTerm: TermResponse = { ...term, price: "25.50" };
  const REFUND_NOTE = "Wypisany po opłaceniu. Odznacz „opłacone” po zwrocie pieniędzy.";
  // The mockup's data: Ola paid and withdrew, so only Anna and Marek are counted.
  const mockupRows: TermAttendeeResponse[] = [
    { ...attendees[0], payment_status: "PAID" },
    attendees[1],
    { ...attendees[2], payment_status: "PAID", withdrawn: true, counted: false },
  ];

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T18:00:00"));
    vi.mocked(termsApi.getTerm).mockResolvedValue(pricedTerm);
    vi.mocked(groupsApi.getGroup).mockResolvedValue(group);
    vi.mocked(groupsApi.getTermAttendees).mockResolvedValue(attendees);
    vi.mocked(groupsApi.getTermAttendance).mockResolvedValue(attendanceRead());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("freeTerm_hidesTheSwitch_unlessTheRowIsPaid", async () => {
    vi.mocked(termsApi.getTerm).mockResolvedValue(term);
    vi.mocked(groupsApi.getTermAttendees).mockResolvedValue([
      attendees[0],
      { ...attendees[1], payment_status: "PAID" },
    ]);
    const { unmount } = renderPage();

    expect(await screen.findByText("Anna Nowak")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "opłacone — Anna Nowak" })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "opłacone — Marek Wiśniewski" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText("2 zapisy · 3 dzieci")).toBeInTheDocument();
    unmount();

    vi.mocked(termsApi.getTerm).mockResolvedValue(pricedTerm);
    renderPage();
    expect(await screen.findByRole("switch", { name: "opłacone — Anna Nowak" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getAllByRole("switch")).toHaveLength(2);
  });

  it("toggle_putsPaidAndDisablesTheSwitchWhilePending", async () => {
    let finish: () => void = () => {};
    vi.mocked(groupsApi.setPaymentStatus).mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    renderPage();

    const toggle = await screen.findByRole("switch", { name: "opłacone — Marek Wiśniewski" });
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).toBeDisabled());
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(groupsApi.setPaymentStatus).toHaveBeenCalledWith(
      GROUP_ID,
      TERM_ID,
      "22222222-2222-4222-8222-222222222222",
      true,
    );
    finish();
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(groupsApi.getTermAttendees).toHaveBeenCalledTimes(2);
  });

  it("open_withdrawnPaidRow_showsThePillTheNoteAndADisabledPresenceBox", async () => {
    vi.mocked(groupsApi.getTermAttendees).mockResolvedValue(mockupRows);
    renderPage();

    const row = (await screen.findByText("Ola Zielińska")).closest("li") as HTMLElement;
    expect(within(row).getByText("wypisany — do zwrotu")).toBeInTheDocument();
    expect(within(row).queryByText("przychodzi bez dzieci")).not.toBeInTheDocument();
    expect(within(row).getByText(REFUND_NOTE)).toBeInTheDocument();
    expect(within(row).getByRole("checkbox", { name: "Ola Zielińska" })).toBeDisabled();
    expect(within(row).getByRole("switch", { name: "opłacone — Ola Zielińska" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Anna Nowak" })).toBeEnabled();
  });

  it("closed_withdrawnCountedPaidRow_showsThePillAndTheNote", async () => {
    vi.mocked(groupsApi.getTermAttendees).mockResolvedValue([
      attendees[0],
      { ...attendees[2], payment_status: "PAID", withdrawn: true, counted: true },
    ]);
    vi.mocked(groupsApi.getTermAttendance).mockResolvedValue(
      attendanceRead({ state: "CLOSED", closed_at: "2026-10-12T19:00:00", auto_close_on: null, rewarded: false }),
    );
    renderPage();

    const row = (await screen.findByText("Ola Zielińska")).closest("li") as HTMLElement;
    expect(within(row).getByText("wypisany — do zwrotu")).toBeInTheDocument();
    expect(within(row).getByText(REFUND_NOTE)).toBeInTheDocument();
    expect(within(row).getByRole("checkbox", { name: "Ola Zielińska" })).toBeDisabled();
    expect(within(row).getByRole("switch", { name: "opłacone — Ola Zielińska" })).toBeEnabled();
  });

  it("closed_withdrawnCountedUnpaidRow_keepsTheChildPillWithoutRefundHint", async () => {
    vi.mocked(groupsApi.getTermAttendees).mockResolvedValue([
      attendees[0],
      { ...attendees[2], withdrawn: true, counted: true },
    ]);
    vi.mocked(groupsApi.getTermAttendance).mockResolvedValue(
      attendanceRead({ state: "CLOSED", closed_at: "2026-10-12T19:00:00", auto_close_on: null, rewarded: false }),
    );
    renderPage();

    const row = (await screen.findByText("Ola Zielińska")).closest("li") as HTMLElement;
    expect(within(row).getByText("przychodzi bez dzieci")).toBeInTheDocument();
    expect(within(row).queryByText("wypisany — do zwrotu")).not.toBeInTheDocument();
    expect(within(row).queryByText(REFUND_NOTE)).not.toBeInTheDocument();
    expect(within(row).getByRole("checkbox", { name: "Ola Zielińska" })).toBeDisabled();
    expect(screen.getByText("2 zapisy · 2 dzieci · opłaceni: 0")).toBeInTheDocument();
  });

  it("counts_useCountedRowsOnly_andTheSubtitleShowsThePrice", async () => {
    vi.mocked(groupsApi.getTermAttendees).mockResolvedValue(mockupRows);
    const { unmount } = renderPage();

    expect(await screen.findByText("2 zapisy · 3 dzieci · opłaceni: 1")).toBeInTheDocument();
    expect(screen.getByText(/godz\. 17:00 · Krąg Maluchy · 25,50\szł$/)).toBeInTheDocument();
    unmount();

    vi.mocked(groupsApi.getTermAttendees).mockResolvedValue([mockupRows[2]]);
    renderPage();
    expect(await screen.findByText("Brak zapisów")).toBeInTheDocument();
    expect(screen.getByText("Ola Zielińska")).toBeInTheDocument();
  });

  it("failedPut_showsThePaymentAlert", async () => {
    vi.mocked(groupsApi.setPaymentStatus)
      .mockRejectedValueOnce(
        new ApiError(409, "Conflict", { title: "Conflict", status: 409, detail: "Termin został usunięty" }),
      );
    renderPage();

    fireEvent.click(await screen.findByRole("switch", { name: "opłacone — Anna Nowak" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Termin został usunięty");
    expect(screen.queryByText("Nie udało się zapisać obecności")).not.toBeInTheDocument();
  });
});
