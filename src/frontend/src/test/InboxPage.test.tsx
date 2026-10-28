import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ApiError } from "../api/client";
import * as conversationsApi from "../api/conversations";
import type { InboxRow } from "../api/conversations";
import { InboxPage } from "../pages/messages/InboxPage";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/conversations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/conversations")>()),
  getConversations: vi.fn(),
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "tok", username: "ania" }) }));

function row(over: Partial<InboxRow> = {}): InboxRow {
  return {
    id: "c1",
    kind: "ITEM",
    title: "Klocki Lego Duplo",
    item: { id: "i1", name: "Klocki Lego Duplo", deleted: false },
    counterpart_name: "Anna K.",
    group_name: null,
    term_occurs_on: null,
    unread_count: 0,
    read_only_reason: null,
    last_message: {
      body: "Tak, są kompletne.",
      sender_name: "Anna K.",
      is_mine: false,
      sender_is_organizer: false,
      created_at: "2026-10-22T10:41:00",
    },
    ...over,
  };
}

function renderInbox() {
  return render(
    <MemoryRouter initialEntries={["/messages"]}>
      <InboxPage />
    </MemoryRouter>,
    { wrapper: createQueryWrapper() },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T14:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("InboxPage", () => {
  it("rows: chip, title, sender prefix, unread bold with a count, link to the thread", async () => {
    vi.mocked(conversationsApi.getConversations).mockResolvedValue([
      row({ unread_count: 2 }),
      row({
        id: "c2",
        kind: "GROUP",
        title: "Joga w parku",
        item: null,
        counterpart_name: null,
        group_name: "Joga w parku",
        read_only_reason: "GROUP_DELETED",
        last_message: { ...row().last_message, sender_name: "Kasia", sender_is_organizer: true, body: "W czwartek sala." },
      }),
      row({
        id: "c3",
        kind: "TERM",
        title: "Termin: śr 29.10 17:00",
        item: null,
        counterpart_name: null,
        group_name: "Joga w parku",
        last_message: { ...row().last_message, sender_name: "Ania", is_mine: true, body: "Przyniosę matę." },
      }),
    ]);
    renderInbox();

    expect(screen.getByRole("heading", { name: "Wiadomości" })).toBeInTheDocument();
    const links = await screen.findAllByRole("link", { name: /Rzecz|Grupa|Termin/ });
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/messages/c1",
      "/messages/c2",
      "/messages/c3",
    ]);

    const [item, group, term] = links;
    expect(within(item).getByText("Rzecz")).toBeInTheDocument();
    expect(within(item).getByText("Klocki Lego Duplo")).toBeInTheDocument();
    expect(item).toHaveTextContent("Anna K.: Tak, są kompletne.");
    expect(item).toHaveTextContent("2 nieprzeczytane");
    expect(within(item).getByText("Klocki Lego Duplo")).toHaveClass("font-extrabold");

    expect(within(group).getByText("Grupa")).toHaveClass("text-primary-fg");
    expect(group).toHaveTextContent("Organizator: W czwartek sala.");
    expect(within(group).getByText("Joga w parku")).not.toHaveClass("font-extrabold");

    expect(within(term).getByText("Termin")).toBeInTheDocument();
    expect(term).toHaveTextContent("Ty: Przyniosę matę.");
    expect(term).toHaveTextContent("12:41");
  });

  it("no conversations: the dashed empty card", async () => {
    vi.mocked(conversationsApi.getConversations).mockResolvedValue([]);
    renderInbox();

    expect(
      await screen.findByText(
        "Nie masz jeszcze rozmów. Zapytaj o rzecz na jej stronie albo napisz na czacie swojej grupy lub terminu.",
      ),
    ).toBeInTheDocument();
  });

  it("loading: a skeleton row", () => {
    vi.mocked(conversationsApi.getConversations).mockReturnValue(new Promise(() => {}));
    renderInbox();

    expect(screen.getByRole("status")).toHaveTextContent("Wczytywanie wiadomości…");
  });

  it("error: inline Polish message with a retry", async () => {
    vi.mocked(conversationsApi.getConversations)
      .mockRejectedValueOnce(new ApiError(500, "Internal Server Error", null))
      .mockResolvedValueOnce([row()]);
    renderInbox();

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się wczytać wiadomości");
    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));

    expect(await screen.findByRole("link", { name: /Klocki Lego Duplo/ })).toBeInTheDocument();
  });
});
