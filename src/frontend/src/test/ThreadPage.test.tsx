import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationResponse, MessageResponse } from "../api/conversations";
import { useConversation } from "../hooks/useConversation";
import { useThread } from "../hooks/useThread";
import { ThreadPage } from "../pages/messages/ThreadPage";

vi.mock("../hooks/useConversation", () => ({ useConversation: vi.fn() }));
vi.mock("../hooks/useThread", () => ({ useThread: vi.fn() }));

const itemConversation: ConversationResponse = {
  id: "c1",
  kind: "ITEM",
  title: "Klocki Lego Duplo",
  item: { id: "i9", name: "Klocki Lego Duplo", deleted: false },
  counterpart_name: "Anna K.",
  group_name: null,
  term_occurs_on: null,
  unread_count: 1,
  read_only_reason: null,
  participant_count: null,
};

const groupConversation: ConversationResponse = {
  id: "c2",
  kind: "GROUP",
  title: "Joga w parku",
  item: null,
  counterpart_name: null,
  group_name: "Joga w parku",
  term_occurs_on: null,
  unread_count: 0,
  read_only_reason: null,
  participant_count: 12,
};

const messages: MessageResponse[] = [
  {
    id: "m1",
    body: "W czwartek zajęcia przenosimy do sali przy Grochowskiej 12.",
    created_at: "2026-10-21T17:10:00",
    is_mine: false,
    sender_name: "Marta Nowak",
    sender_is_organizer: true,
  },
  {
    id: "m2",
    body: "Dzięki za info!",
    created_at: "2026-10-21T17:22:00",
    is_mine: false,
    sender_name: "Kasia W.",
    sender_is_organizer: false,
  },
  {
    id: "m3",
    body: "Będziemy z Zosią",
    created_at: "2026-10-21T17:30:00",
    is_mine: true,
    sender_name: "Ala K.",
    sender_is_organizer: false,
  },
];

const markRead = vi.fn();

function mockConversation(partial: Partial<ReturnType<typeof useConversation>>) {
  vi.mocked(useConversation).mockReturnValue({
    conversation: null,
    notFound: false,
    denied: false,
    loading: false,
    error: null,
    refetch: vi.fn().mockResolvedValue(undefined),
    ...partial,
  });
}

function mockThread(items: MessageResponse[] = messages) {
  vi.mocked(useThread).mockReturnValue({
    items,
    hasOlder: false,
    loading: false,
    error: null,
    refetch: vi.fn().mockResolvedValue(undefined),
    loadOlder: vi.fn().mockResolvedValue(undefined),
    loadingOlder: false,
    send: vi.fn().mockResolvedValue(undefined),
    markRead,
  });
}

function renderPage(id = "c1") {
  return render(
    <MemoryRouter initialEntries={[`/messages/${id}`]}>
      <Routes>
        <Route path="/messages/:conversationId" element={<ThreadPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ThreadPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    markRead.mockResolvedValue(undefined);
    mockThread();
  });

  it("itemThread_header_showsCounterpartAndItemLink", () => {
    mockConversation({ conversation: itemConversation });
    renderPage();

    const header = screen.getByRole("banner");
    expect(within(header).getByRole("heading", { name: "Klocki Lego Duplo" })).toBeInTheDocument();
    expect(header).toHaveTextContent("Rozmowa z: Anna K. · zobacz rzecz");
    expect(within(header).getByRole("link", { name: "zobacz rzecz" })).toHaveAttribute("href", "/product/i9");
    expect(screen.getByLabelText("Wiadomość")).toBeInTheDocument();
  });

  it("itemThread_deletedItem_showsUsunieteWithoutLink", () => {
    mockConversation({
      conversation: { ...itemConversation, item: { id: "i9", name: "Klocki Lego Duplo", deleted: true } },
    });
    renderPage();

    const header = screen.getByRole("banner");
    expect(header).toHaveTextContent("(usunięte)");
    expect(within(header).queryByRole("link", { name: "zobacz rzecz" })).not.toBeInTheDocument();
  });

  it("itemThread_narrowHeader_truncatesCounterpartNotItemLink", () => {
    mockConversation({ conversation: itemConversation });
    renderPage();

    const link = within(screen.getByRole("banner")).getByRole("link", { name: "zobacz rzecz" });
    expect(link).toHaveClass("shrink-0", "whitespace-nowrap");
    expect(screen.getByText("Rozmowa z: Anna K.")).toHaveClass("min-w-0", "truncate");
  });

  it("messageList_containsSrOnlyLabels_andOptsOutOfBrowserScrollAnchoring", () => {
    mockConversation({ conversation: groupConversation });
    renderPage("c2");

    const log = screen.getByRole("log", { name: "Wiadomości" });
    // `relative` keeps the absolutely positioned sr-only labels from growing the document.
    expect(log).toHaveClass("relative", "[overflow-anchor:none]");
    expect(within(log).getByText("Ty:")).toHaveClass("sr-only");
  });

  it.each([
    ["denied", { denied: true }, false],
    ["notFound", { notFound: true }, false],
    ["ready", { conversation: groupConversation }, true],
  ] as const)("%s_conversation_setsThreadPolling", (_name, partial, poll) => {
    mockConversation(partial);
    renderPage("c2");

    expect(useThread).toHaveBeenCalledWith("c2", { poll });
  });

  it("groupThread_showsParticipantsSenderNamesAndOrganizerChip", () => {
    mockConversation({ conversation: groupConversation });
    renderPage("c2");

    const header = screen.getByRole("banner");
    expect(within(header).getByRole("heading", { name: "Joga w parku · czat grupy" })).toBeInTheDocument();
    expect(header).toHaveTextContent("12 uczestników");
    expect(screen.getByText("Marta Nowak")).toBeInTheDocument();
    expect(screen.getByText("Organizator")).toBeInTheDocument();
    expect(screen.getByText("Kasia W.")).toBeInTheDocument();
    expect(screen.getByText("Będziemy z Zosią")).toBeInTheDocument();
  });

  it.each([
    ["GROUP_DELETED", "Grupa usunięta", "Grupa usunięta — czat jest tylko do odczytu"],
    ["GROUP_PUBLIC", "Grupa publiczna", "Grupa jest publiczna — czat jest tylko do odczytu"],
  ] as const)("readOnly_%s_showsBannerInsteadOfComposer", (reason, headerLine, banner) => {
    mockConversation({ conversation: { ...groupConversation, read_only_reason: reason } });
    renderPage("c2");

    expect(screen.getByRole("banner")).toHaveTextContent(headerLine);
    expect(screen.getByRole("status")).toHaveTextContent(banner);
    expect(screen.queryByLabelText("Wiadomość")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wyślij" })).not.toBeInTheDocument();
  });

  it.each([
    [{ notFound: true }, "Nie znaleziono rozmowy."],
    [{ denied: true }, "Nie masz dostępu do tej rozmowy."],
  ])("unavailable_%o_showsCopyAndInboxLink", (state, copy) => {
    mockConversation(state);
    renderPage();

    expect(screen.getByText(copy)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wróć do wiadomości" })).toHaveAttribute("href", "/messages");
    expect(markRead).not.toHaveBeenCalled();
  });

  it("readMarker_marksNewestHeldMessage_andAgainWhenItChanges", async () => {
    mockConversation({ conversation: groupConversation });
    mockThread(messages.slice(0, 2));
    const { rerender } = renderPage("c2");

    await waitFor(() => expect(markRead).toHaveBeenCalledWith("m2"));
    expect(markRead).toHaveBeenCalledTimes(1);

    mockThread([
      ...messages,
      { ...messages[1], id: "m4", body: "Nowa", created_at: "2026-10-21T17:40:00" },
    ]);
    rerender(
      <MemoryRouter initialEntries={["/messages/c2"]}>
        <Routes>
          <Route path="/messages/:conversationId" element={<ThreadPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(markRead).toHaveBeenCalledWith("m4"));
    expect(markRead).toHaveBeenCalledTimes(2);
  });

  it("readMarker_newestMessageIsMine_skipsMarkRead", async () => {
    mockConversation({ conversation: groupConversation });
    renderPage("c2");

    expect(await screen.findByText("Będziemy z Zosią")).toBeInTheDocument();
    expect(markRead).not.toHaveBeenCalled();
  });

  it("writableThread_focusesComposer", () => {
    mockConversation({ conversation: itemConversation });
    renderPage();

    expect(screen.getByLabelText("Wiadomość")).toHaveFocus();
  });

  it("readOnlyThread_doesNotMoveFocus", () => {
    mockConversation({ conversation: { ...groupConversation, read_only_reason: "GROUP_DELETED" } });
    renderPage("c2");

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(document.body).toHaveFocus();
  });

  it("sendRejectedAsReadOnly_refetchesConversation_andShowsAlertKeepingText", async () => {
    const refetchConversation = vi.fn().mockResolvedValue(undefined);
    mockConversation({ conversation: groupConversation, refetch: refetchConversation });
    const send = vi.fn().mockRejectedValue(new Error("Grupa jest publiczna — czat jest tylko do odczytu"));
    vi.mocked(useThread).mockReturnValue({ ...vi.mocked(useThread)(""), send });
    renderPage("c2");

    fireEvent.change(screen.getByLabelText("Wiadomość"), { target: { value: "Czy jutro gramy?" } });
    fireEvent.click(screen.getByRole("button", { name: "Wyślij" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Grupa jest publiczna — czat jest tylko do odczytu");
    expect(send).toHaveBeenCalledWith("Czy jutro gramy?");
    expect(refetchConversation).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Wiadomość")).toHaveValue("Czy jutro gramy?");
  });

  it("olderMessagesButton_callsLoadOlder_andShowsItsErrorInline", async () => {
    mockConversation({ conversation: itemConversation });
    const loadOlder = vi.fn().mockRejectedValue(new Error("Nie udało się wczytać wiadomości"));
    vi.mocked(useThread).mockReturnValue({ ...vi.mocked(useThread)(""), hasOlder: true, loadOlder });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Wcześniejsze wiadomości" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się wczytać wiadomości");
    expect(loadOlder).toHaveBeenCalledTimes(1);
  });
});
