import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import * as conversationsApi from "../api/conversations";
import { MessagesButton } from "../components/shared/MessagesButton";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/conversations", () => ({ getUnreadMessageCount: vi.fn(), chatErrorMessage: vi.fn() }));

let mockAuth: { token: string | null; username?: string };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

function renderButton(path = "/panel") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MessagesButton />
    </MemoryRouter>,
    { wrapper: createQueryWrapper() },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth = { token: "tok", username: "ania" };
});

describe("MessagesButton", () => {
  it.each([
    [3, "Wiadomości (3 nieprzeczytane)", "3"],
    [12, "Wiadomości (12 nieprzeczytane)", "9+"],
  ])("unread %i: badge and aria-label", async (count, label, badge) => {
    vi.mocked(conversationsApi.getUnreadMessageCount).mockResolvedValue({ count });
    renderButton();

    const link = await screen.findByRole("link", { name: label });
    expect(link).toHaveAttribute("href", "/panel/wiadomosci");
    expect(link).toHaveTextContent(badge);
  });

  it("no unread: plain label and no badge", async () => {
    vi.mocked(conversationsApi.getUnreadMessageCount).mockResolvedValue({ count: 0 });
    renderButton();

    const link = screen.getByRole("link", { name: "Wiadomości" });
    await waitFor(() => expect(conversationsApi.getUnreadMessageCount).toHaveBeenCalled());
    await act(async () => {});
    expect(link).toHaveAttribute("href", "/panel/wiadomosci");
    expect(link.querySelector("[data-testid='messages-badge']")).toBeNull();
  });

  it("on the inbox: marked as the current page", async () => {
    vi.mocked(conversationsApi.getUnreadMessageCount).mockResolvedValue({ count: 0 });
    renderButton("/panel/wiadomosci");

    expect(await screen.findByRole("link", { name: "Wiadomości" })).toHaveAttribute("aria-current", "page");
  });

  it("logged out: renders nothing", () => {
    mockAuth = { token: null };
    renderButton();

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(conversationsApi.getUnreadMessageCount).not.toHaveBeenCalled();
  });
});
