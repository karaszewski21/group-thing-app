import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GroupDetailsPage } from "../pages/panel/GroupDetailsPage";
import * as groupsApi from "../api/groups";
import { ApiError } from "../api/client";
import type { GroupMemberResponse, GroupResponse } from "../api/groups";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/groups", () => ({
  getGroup: vi.fn(),
  getGroupMembers: vi.fn(),
}));

const GROUP_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

const group: GroupResponse = {
  id: GROUP_ID,
  party_id: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
  name: "Krąg Maluchy",
  organizer_slug: "maluchy",
  layout_mode: "PITCH",
  visibility: "PRIVATE",
  created_at: "2026-09-01T10:00:00",
  updated_at: "2026-09-01T10:00:00",
  default_location: {
    id: "loc-1",
    name: "Dom kultury",
    formatted_address: "ul. Długa 1, Warszawa",
    google_place_id: null,
    notes: null,
    deleted_at: null,
  },
  default_capacity: 12,
};

const members: GroupMemberResponse[] = [
  {
    party_id: "11111111-1111-4111-8111-111111111111",
    display_name: "Anna Nowak",
    family_name: "Rodzina Nowak",
    terms_attended: 3,
    last_term_on: "2026-09-10T17:00:00",
  },
  {
    party_id: "22222222-2222-4222-8222-222222222222",
    display_name: "Marek Wiśniewski",
    family_name: null,
    terms_attended: 1,
    last_term_on: "2026-10-01T10:00:00",
  },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/panel/grupy/${GROUP_ID}`]}>
      <Routes>
        <Route path="/panel/grupy/:groupId" element={<GroupDetailsPage />} />
      </Routes>
    </MemoryRouter>,
    { wrapper: createQueryWrapper() },
  );
}

describe("GroupDetailsPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(groupsApi.getGroup).mockResolvedValue(group);
    vi.mocked(groupsApi.getGroupMembers).mockResolvedValue(members);
  });

  it("renders group details and the member list", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Krąg Maluchy" })).toBeInTheDocument();
    expect(screen.getByText("2 uczestników")).toBeInTheDocument();
    expect(screen.getByText("Prywatna (dostęp na prośbę)")).toBeInTheDocument();
    expect(screen.getByText("Boisko")).toBeInTheDocument();
    expect(screen.getByText("Dom kultury · ul. Długa 1, Warszawa")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("1 września 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Zobacz stronę organizatora/ })).toHaveAttribute(
      "href",
      "/maluchy",
    );

    expect(screen.getByText("Anna Nowak")).toBeInTheDocument();
    expect(screen.getByText("Rodzina Nowak")).toBeInTheDocument();
    expect(screen.getByText("3 terminy")).toBeInTheDocument();
    expect(screen.getByText("ostatnio: 10 września 2026")).toBeInTheDocument();
    expect(screen.getByText("Marek Wiśniewski")).toBeInTheDocument();
    expect(screen.getByText("1 termin")).toBeInTheDocument();
    expect(screen.getByText("ostatnio: 1 października 2026")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);

    expect(groupsApi.getGroup).toHaveBeenCalledWith(GROUP_ID);
    expect(groupsApi.getGroupMembers).toHaveBeenCalledWith(GROUP_ID);
  });

  it("shows the panel bottom nav with no tab highlighted", async () => {
    renderPage();
    await screen.findByText("Anna Nowak");

    const nav = screen.getByRole("navigation", { name: "Nawigacja panelu" });
    expect(within(nav).getAllByRole("button")).toHaveLength(4);
    for (const tab of within(nav).getAllByRole("button")) {
      expect(tab).not.toHaveAttribute("aria-current", "true");
    }
  });

  it("shows the fallbacks for a bare group and an empty member list", async () => {
    vi.mocked(groupsApi.getGroup).mockResolvedValue({
      ...group,
      organizer_slug: null,
      default_location: null,
      default_capacity: null,
    });
    vi.mocked(groupsApi.getGroupMembers).mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText("Brak uczestników")).toBeInTheDocument();
    expect(screen.getByText("Nie ustawiono")).toBeInTheDocument();
    expect(screen.getByText("Bez limitu")).toBeInTheDocument();
    expect(screen.getByText("Nikt jeszcze nie zapisał się na żaden termin tej grupy.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Zobacz stronę organizatora/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("members 403 shows denied", async () => {
    vi.mocked(groupsApi.getGroupMembers).mockRejectedValue(new ApiError(403, "Forbidden", null));
    renderPage();

    expect(await screen.findByText("Nie masz dostępu do tej grupy.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Spróbuj ponownie" })).not.toBeInTheDocument();
  });

  it("unknown group 404 shows notFound", async () => {
    vi.mocked(groupsApi.getGroup).mockRejectedValue(new ApiError(404, "Not Found", null));
    renderPage();

    expect(await screen.findByText("Nie znaleziono tej grupy.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Wróć/ })).toHaveAttribute("href", "/panel/spotkania");
  });

  it("generic error retry refetches", async () => {
    vi.mocked(groupsApi.getGroupMembers)
      .mockRejectedValueOnce(new ApiError(500, "Internal Server Error", null))
      .mockResolvedValue(members);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Spróbuj ponownie" }));

    await waitFor(() => expect(groupsApi.getGroupMembers).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Anna Nowak")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Spróbuj ponownie" })).not.toBeInTheDocument();
  });
});
