import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupDetailsPage } from "../pages/panel/GroupDetailsPage";
import * as groupsApi from "../api/groups";
import * as termsApi from "../api/terms";
import { ApiError } from "../api/client";
import type { GroupMemberResponse, GroupResponse } from "../api/groups";
import type { TermResponse } from "../api/terms";
import { termPublicPath } from "../pages/panel/panelHelpers";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/groups", () => ({
  getGroup: vi.fn(),
  getGroupMembers: vi.fn(),
  getJoinCode: vi.fn(),
  regenerateJoinCode: vi.fn(),
}));
vi.mock("../api/terms", () => ({ getTerms: vi.fn() }));
const conversationHook = vi.hoisted(() => ({ openConversation: vi.fn() }));
vi.mock("../hooks/useOpenConversation", () => ({ useOpenConversation: () => conversationHook }));


// jsdom has no navigator.clipboard; call history is wiped by vi.resetAllMocks().
const clipboardWriteText = vi.fn();
Object.assign(navigator, { clipboard: { writeText: clipboardWriteText } });

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
        <Route path="/panel/wiadomosci/:id" element={<p>Wątek rozmowy</p>} />
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
    vi.mocked(groupsApi.getJoinCode).mockRejectedValue(new ApiError(403, "Forbidden", null));
    vi.mocked(termsApi.getTerms).mockResolvedValue([]);
    clipboardWriteText.mockResolvedValue(undefined);
  });

  it("renders group details and the member list", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Krąg Maluchy" })).toBeInTheDocument();
    expect(screen.getByText("2 uczestników")).toBeInTheDocument();
    expect(screen.getByText("Prywatna (dostęp z kodem)")).toBeInTheDocument();
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

  describe("group chat card", () => {
    it("is shown above the code card to the organizer of a PRIVATE group and opens the group chat", async () => {
      vi.mocked(groupsApi.getJoinCode).mockResolvedValue({ code: "482913" });
      conversationHook.openConversation.mockResolvedValue("conv-3");
      renderPage();

      const card = await screen.findByRole("region", { name: "Czat grupy" });
      expect(within(card).getByText("Napisz do wszystkich członków grupy.")).toBeInTheDocument();
      const codeCard = await screen.findByRole("region", { name: "Kod dostępu" });
      expect(card.compareDocumentPosition(codeCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      fireEvent.click(within(card).getByRole("button", { name: "Otwórz czat grupy" }));

      expect(await screen.findByText("Wątek rozmowy")).toBeInTheDocument();
      expect(conversationHook.openConversation).toHaveBeenCalledWith({ kind: "GROUP", id: GROUP_ID });
    });

    it("stays shown when the join-code fetch fails with something other than 403", async () => {
      vi.mocked(groupsApi.getJoinCode).mockRejectedValue(new ApiError(500, "Server Error", null));
      renderPage();

      expect(await screen.findByRole("region", { name: "Czat grupy" })).toBeInTheDocument();
    });

    it("is absent for a member (code 403) and for a PUBLIC group", async () => {
      const { unmount } = renderPage();
      await screen.findByText("Anna Nowak");
      await waitFor(() => expect(groupsApi.getJoinCode).toHaveBeenCalled());
      expect(screen.queryByRole("region", { name: "Czat grupy" })).not.toBeInTheDocument();
      unmount();

      vi.mocked(groupsApi.getGroup).mockResolvedValue({ ...group, visibility: "PUBLIC" });
      renderPage();
      await screen.findByText("Anna Nowak");
      expect(screen.queryByRole("region", { name: "Czat grupy" })).not.toBeInTheDocument();
    });
  });

  describe("join code card", () => {
    function term(id: string, occursOn: string): TermResponse {
      return {
        id,
        circle_group_id: GROUP_ID,
        occurs_on: occursOn,
        description: null,
        created_at: "",
        updated_at: "",
        attendee_count: null,
        child_count: null,
      };
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-21T12:00:00"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows the code to a PRIVATE organizer and nothing on 403", async () => {
      vi.mocked(groupsApi.getJoinCode).mockResolvedValue({ code: "482913" });
      const { unmount } = renderPage();

      const card = await screen.findByRole("region", { name: "Kod dostępu" });
      expect(await within(card).findByText("482 913")).toBeInTheDocument();
      expect(within(card).getByText("Podaj go osobom, które mają dołączyć do grupy.")).toBeInTheDocument();
      expect(groupsApi.getJoinCode).toHaveBeenCalledWith(GROUP_ID);
      unmount();

      vi.mocked(groupsApi.getJoinCode).mockRejectedValue(new ApiError(403, "Forbidden", null));
      renderPage();
      await screen.findByText("Anna Nowak");
      await waitFor(() => expect(groupsApi.getJoinCode).toHaveBeenCalledTimes(2));
      expect(screen.queryByRole("region", { name: "Kod dostępu" })).not.toBeInTheDocument();
      expect(screen.queryByText("Kod dostępu")).not.toBeInTheDocument();
      expect(termsApi.getTerms).toHaveBeenCalledTimes(1);
    });

    it("a PUBLIC group never asks for a code and shows no card", async () => {
      vi.mocked(groupsApi.getGroup).mockResolvedValue({ ...group, visibility: "PUBLIC" });
      vi.mocked(groupsApi.getJoinCode).mockResolvedValue({ code: "482913" });
      renderPage();

      await screen.findByText("Anna Nowak");
      expect(screen.queryByRole("region", { name: "Kod dostępu" })).not.toBeInTheDocument();
      expect(groupsApi.getJoinCode).not.toHaveBeenCalled();
      expect(termsApi.getTerms).not.toHaveBeenCalled();
    });

    it("shows a skeleton while loading and an inline retry on a 500", async () => {
      let rejectFirst: (err: unknown) => void = () => {};
      vi.mocked(groupsApi.getJoinCode)
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectFirst = reject;
            }),
        )
        .mockResolvedValue({ code: "482913" });
      renderPage();

      const skeleton = await screen.findByRole("region", { name: "Kod dostępu" });
      expect(skeleton).toHaveAttribute("aria-busy", "true");

      rejectFirst(new ApiError(500, "Internal Server Error", null));
      expect(await screen.findByText("Nie udało się wczytać kodu dostępu.")).toHaveAttribute("role", "alert");
      expect(screen.queryByText(/500/)).not.toBeInTheDocument();

      const card = screen.getByRole("region", { name: "Kod dostępu" });
      fireEvent.click(within(card).getByRole("button", { name: "Spróbuj ponownie" }));
      expect(await screen.findByText("482 913")).toBeInTheDocument();
      expect(groupsApi.getJoinCode).toHaveBeenCalledTimes(2);
    });

    it("copies the raw code and a link to the nearest upcoming term; no link without one", async () => {
      vi.mocked(groupsApi.getJoinCode).mockResolvedValue({ code: "482913" });
      vi.mocked(termsApi.getTerms).mockResolvedValue([
        term("t-later", "2026-10-28T17:00:00"),
        term("t-past", "2026-10-20T17:00:00"),
        term("t-today", "2026-10-21T08:00:00"),
      ]);
      const { unmount } = renderPage();

      fireEvent.click(await screen.findByRole("button", { name: "Kopiuj kod" }));
      await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledWith("482913"));
      expect(await screen.findByText("Skopiowano kod")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Skopiowano kod");

      fireEvent.click(await screen.findByRole("button", { name: "Kopiuj link z kodem" }));
      await waitFor(() =>
        expect(clipboardWriteText).toHaveBeenLastCalledWith(
          `${window.location.origin}${termPublicPath(group, "t-today")}#code=482913`,
        ),
      );
      expect(await screen.findByText("Skopiowano link")).toBeInTheDocument();
      unmount();

      vi.mocked(termsApi.getTerms).mockResolvedValue([term("t-past", "2026-10-20T17:00:00")]);
      renderPage();
      expect(await screen.findByRole("button", { name: "Kopiuj kod" })).toBeInTheDocument();
      await waitFor(() => expect(termsApi.getTerms).toHaveBeenCalledTimes(2));
      expect(screen.queryByRole("button", { name: "Kopiuj link z kodem" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Wygeneruj nowy kod" })).toBeInTheDocument();
    });

    it("regenerates the code after confirming", async () => {
      vi.mocked(groupsApi.getJoinCode).mockResolvedValue({ code: "482913" });
      vi.mocked(groupsApi.regenerateJoinCode).mockResolvedValue({ code: "105377" });
      renderPage();

      fireEvent.click(await screen.findByRole("button", { name: "Wygeneruj nowy kod" }));
      const dialog = screen.getByRole("alertdialog", { name: "Wygenerować nowy kod?" });
      expect(dialog).toHaveAccessibleDescription(
        "Stary kod przestanie działać. Osoby, które już dołączyły, zostają w grupie.",
      );
      fireEvent.click(within(dialog).getByRole("button", { name: "Wygeneruj nowy kod" }));

      expect(await screen.findByText("105 377")).toBeInTheDocument();
      expect(groupsApi.regenerateJoinCode).toHaveBeenCalledWith(GROUP_ID);
      expect(groupsApi.getJoinCode).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(screen.getByRole("status")).toHaveTextContent("Wygenerowano nowy kod");
    });

    it("keeps the confirm open with the server message when regenerating fails", async () => {
      vi.mocked(groupsApi.getJoinCode).mockResolvedValue({ code: "482913" });
      vi.mocked(groupsApi.regenerateJoinCode).mockRejectedValue(
        new ApiError(409, "Conflict", { message: "Konflikt — spróbuj ponownie" }),
      );
      renderPage();

      fireEvent.click(await screen.findByRole("button", { name: "Wygeneruj nowy kod" }));
      const dialog = screen.getByRole("alertdialog", { name: "Wygenerować nowy kod?" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Wygeneruj nowy kod" }));

      expect(await within(dialog).findByRole("alert")).toHaveTextContent("Konflikt — spróbuj ponownie");
      expect(screen.queryByText(/409 Conflict/)).not.toBeInTheDocument();
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      expect(screen.getByText("482 913")).toBeInTheDocument();
    });
  });
});
