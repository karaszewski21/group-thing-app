import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as groupsApi from "../api/groups";
import { AttendingTab } from "../features/meetings/tabs/AttendingTab";
import type { UseMyTermsResult } from "../hooks/useMyTerms";
import type { GuestTermCard } from "../utils/appHelpers";
import { renderWithRoute } from "./renderWithRoute";

vi.mock("../api/groups", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/groups")>()),
  withdrawMyAttendance: vi.fn(),
}));

const showToast = vi.fn<(message: string) => void>();
const load = vi.fn<(options?: { silent?: boolean }) => Promise<void>>();
const appData: { savedCards: GuestTermCard[]; showToast: typeof showToast; load: typeof load } = {
  savedCards: [],
  showToast,
  load,
};
vi.mock("../features/panel/appDataStore", () => ({ useAppData: () => appData }));

const memberPage: UseMyTermsResult = {
  terms: [],
  total: 0,
  loading: false,
  error: null,
  hasNextPage: false,
  fetchNextPage: async () => {},
  fetchingNextPage: false,
  nextPageError: null,
};
vi.mock("../hooks/useMyTerms", () => ({ useMyTerms: () => memberPage }));
vi.mock("../hooks/useAttendingEvents", () => ({
  useAttendingEvents: () => ({ data: [], loading: false, error: null, refetch: async () => {} }),
}));
vi.mock("../hooks/useMyPledges", () => ({
  useMyPledges: () => ({ data: [], loading: false, error: null, refetch: async () => {}, withdraw: async () => {} }),
}));
vi.mock("../hooks/useNeededItems", () => ({
  useNeededItems: () => ({ data: new Map(), loading: false, error: null, refetch: async () => {} }),
}));

const ATTENDANCE_ID = "7a1b2c3d-4e5f-4a6b-8c7d-0000000000f1";

function card(overrides: Partial<GuestTermCard> = {}): GuestTermCard {
  return {
    termId: "t1",
    attendanceId: ATTENDANCE_ID,
    occursOn: "2026-12-06T10:00:00",
    groupName: "Sobotnia zamiana ubranek",
    description: null,
    href: "/ania/group/g/term/t1",
    location: null,
    capacity: null,
    attendeeCount: 3,
    price: null,
    paymentStatus: "UNPAID",
    ...overrides,
  };
}

const withdrawn: groupsApi.WithdrawAttendanceResponse = {
  id: ATTENDANCE_ID,
  term_id: "t1",
  party_id: "p1",
  child_count: 0,
  withdrawn_at: "2026-11-24T12:00:00Z",
};

function openWithdrawDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Wypisz się z terminu: Sobotnia zamiana ubranek" }));
  return screen.getByRole("alertdialog", { name: "Wypisać się z terminu?" });
}

describe("Moje zajęcia — withdrawing from a term", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    appData.load.mockResolvedValue(undefined);
    appData.savedCards = [card()];
  });

  it("offers 'Wypisz się' on an attended card only, not on a membership-only one", () => {
    appData.savedCards = [card(), card({ termId: "t2", attendanceId: null, groupName: "Krąg rodzinny" })];
    renderWithRoute(<AttendingTab />, { url: "/meetings" });

    expect(screen.getByRole("button", { name: "Wypisz się z terminu: Sobotnia zamiana ubranek" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Krąg rodzinny/ })).not.toBeInTheDocument();
  });

  it("withdraws the attendance on confirm, refreshes the panel data and closes the dialog", async () => {
    vi.mocked(groupsApi.withdrawMyAttendance).mockResolvedValue(withdrawn);
    renderWithRoute(<AttendingTab />, { url: "/meetings" });

    const dialog = openWithdrawDialog();
    expect(dialog).not.toHaveTextContent(/zwrot/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Wypisz się" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(groupsApi.withdrawMyAttendance).toHaveBeenCalledWith(ATTENDANCE_ID);
    expect(appData.load).toHaveBeenCalledWith({ silent: true });
    expect(appData.showToast).toHaveBeenCalledWith("Wypisano z terminu");
  });

  it("adds the refund note when the attendance is paid", () => {
    appData.savedCards = [card({ price: "25.50", paymentStatus: "PAID" })];
    renderWithRoute(<AttendingTab />, { url: "/meetings" });

    expect(openWithdrawDialog()).toHaveTextContent(
      "Płatność jest oznaczona jako opłacona — zwrot ustalasz z organizatorem.",
    );
  });

  it("shows the server's message inline and keeps the dialog open when the withdraw fails", async () => {
    vi.mocked(groupsApi.withdrawMyAttendance).mockRejectedValue(
      new ApiError(409, "Conflict", { type: "about:blank", title: "Conflict", status: 409, detail: "Termin już się odbył" }),
    );
    renderWithRoute(<AttendingTab />, { url: "/meetings" });

    const dialog = openWithdrawDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Wypisz się" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Termin już się odbył");
    expect(appData.load).not.toHaveBeenCalled();
  });
});
