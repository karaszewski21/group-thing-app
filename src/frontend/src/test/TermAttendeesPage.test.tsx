import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TermAttendeesPage } from "../pages/panel/TermAttendeesPage";
import * as termsApi from "../api/terms";
import * as groupsApi from "../api/groups";
import { ApiError } from "../api/client";
import type { TermResponse } from "../api/terms";
import type { GroupResponse, TermAttendeeResponse } from "../api/groups";
import dayjs from "../utils/dayjs";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/terms", () => ({
  getTerm: vi.fn(),
}));

vi.mock("../api/groups", () => ({
  getGroup: vi.fn(),
  getTermAttendeesForFormalization: vi.fn(),
}));

const TERM_ID = "3f2b8c1e-7a4d-4e9b-9c1a-2d5e6f7a8b9c";
const GROUP_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

const term: TermResponse = {
  id: TERM_ID,
  circle_group_id: GROUP_ID,
  occurs_on: "2026-10-12T17:00:00",
  description: "Zabawy sensoryczne",
  created_at: "2026-09-01T10:00:00",
  updated_at: "2026-09-01T10:00:00",
  attendee_count: 3,
  child_count: 3,
};

const group: GroupResponse = {
  id: GROUP_ID,
  party_id: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
  name: "Krąg Maluchy",
  organizer_slug: "maluchy",
  layout_mode: "ITEMS_FIRST" as GroupResponse["layout_mode"],
  visibility: "PUBLIC" as GroupResponse["visibility"],
  created_at: "2026-09-01T10:00:00",
  updated_at: "2026-09-01T10:00:00",
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
    already_member: false,
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
  return render(
    <MemoryRouter initialEntries={[`/panel/terminy/${TERM_ID}`]}>
      <Routes>
        <Route path="/panel/terminy/:termId" element={<TermAttendeesPage />} />
      </Routes>
    </MemoryRouter>,
    { wrapper: createQueryWrapper() },
  );
}

describe("TermAttendeesPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(termsApi.getTerm).mockResolvedValue(term);
    vi.mocked(groupsApi.getGroup).mockResolvedValue(group);
    vi.mocked(groupsApi.getTermAttendeesForFormalization).mockResolvedValue(attendees);
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
    expect(screen.getByRole("heading", { name: "Zapisani" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Zobacz stronę terminu/ })).toHaveAttribute(
      "href",
      `/maluchy/grupa/${GROUP_ID}/term/${TERM_ID}`,
    );
  });

  it("summary and empty state", async () => {
    const { unmount } = renderPage();
    expect(await screen.findByText("3 zapisy · 3 dzieci")).toBeInTheDocument();
    unmount();

    vi.mocked(groupsApi.getTermAttendeesForFormalization).mockResolvedValue([]);
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
    expect(groupsApi.getTermAttendeesForFormalization).toHaveBeenCalledWith(GROUP_ID, TERM_ID);
  });

  it("attendees 403 shows denied", async () => {
    vi.mocked(groupsApi.getTermAttendeesForFormalization).mockRejectedValue(
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
    expect(groupsApi.getTermAttendeesForFormalization).not.toHaveBeenCalled();
  });

  it("getGroup 500 shows error with retry and minimal header", async () => {
    vi.mocked(groupsApi.getGroup).mockRejectedValue(
      new ApiError(500, "Internal Server Error", null),
    );
    renderPage();

    expect(await screen.findByRole("button", { name: "Spróbuj ponownie" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Wróć/ })).toHaveAttribute("href", "/panel/spotkania");
    expect(screen.getByRole("heading", { name: "Zapisani" })).toBeInTheDocument();
    expect(screen.queryByText("Krąg Maluchy")).not.toBeInTheDocument();
    expect(screen.queryByText(/Zobacz stronę terminu/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+ zapis|^Brak zapisów$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("generic attendees error retry refetches", async () => {
    vi.mocked(groupsApi.getTermAttendeesForFormalization)
      .mockRejectedValueOnce(new ApiError(500, "Internal Server Error", null))
      .mockResolvedValue(attendees);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Spróbuj ponownie" }));

    await waitFor(() =>
      expect(groupsApi.getTermAttendeesForFormalization).toHaveBeenCalledTimes(2),
    );
    expect(await screen.findByText("Anna Nowak")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Spróbuj ponownie" })).not.toBeInTheDocument();
  });

  it("a family whose children all lack a birth year shows only 'wiek nieznany'", async () => {
    vi.mocked(groupsApi.getTermAttendeesForFormalization).mockResolvedValue([
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
});
