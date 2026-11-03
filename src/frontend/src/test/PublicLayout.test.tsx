import { fireEvent, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../auth/AuthGuard";
import * as conversationsApi from "../api/conversations";
import * as notificationsApi from "../api/notifications";
import { PublicLayout } from "../components/layout/PublicLayout";
import { createQueryWrapper } from "./queryClient";
import { getTestLocation, renderWithRoute } from "./renderWithRoute";
import { resetSnoozeStoreForTests } from "../components/layout/pending/snoozeStore";

vi.mock("../api/conversations", () => ({ getUnreadMessageCount: vi.fn(), chatErrorMessage: vi.fn() }));
vi.mock("../api/notifications", () => ({
  getMyNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

let mockAuth: { token: string | null; username?: string };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

function inLayout(page: ReactNode) {
  return <PublicLayout>{page}</PublicLayout>;
}

function renderPublicPage(initialEntry = "/skrzaty") {
  return renderWithRoute(inLayout(<h1>Strona publiczna</h1>), {
    url: initialEntry,
    pattern: "/:organizationSlug",
    routes: {
      "/": inLayout(<h1>Start</h1>),
      "/account": inLayout(
        <AuthGuard>
          <h1>Konto</h1>
        </AuthGuard>,
      ),
      "/profile": inLayout(<h1>Profil</h1>),
      "/messages/:conversationId": inLayout(<h1>Wątek</h1>),
      "/login": <h1>Logowanie</h1>,
    },
    wrapper: createQueryWrapper(),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  resetSnoozeStoreForTests();
  mockAuth = { token: null };
  vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([]);
  vi.mocked(conversationsApi.getUnreadMessageCount).mockResolvedValue({ count: 0 });
});

describe("PublicLayout", () => {
  it("anonymous: the top bar's bell goes to /login and back to the page, no 'Zaloguj się'", () => {
    renderPublicPage();

    expect(screen.getByRole("heading", { name: "Strona publiczna" })).toBeInTheDocument();
    const bar = screen.getByRole("navigation", { name: "Menu konta" });
    expect(within(bar).getByRole("link", { name: "Powiadomienia" })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fskrzaty",
    );
    expect(within(bar).getByRole("link", { name: "Spotkania" })).toHaveAttribute("href", "/meetings");
    expect(within(bar).queryByRole("link", { name: "Zaloguj się" })).not.toBeInTheDocument();
    expect(notificationsApi.getMyNotifications).not.toHaveBeenCalled();
  });

  it("anonymous on Start: the bell goes to plain /login", () => {
    renderPublicPage("/");

    const bar = screen.getByRole("navigation", { name: "Menu konta" });
    expect(within(bar).getByRole("link", { name: "Powiadomienia" })).toHaveAttribute("href", "/login");
  });

  it("anonymous: the bottom nav is shown and a logged-in-only tab goes to /login and back", () => {
    renderPublicPage();

    const nav = screen.getByRole("navigation", { name: "Nawigacja główna" });
    fireEvent.click(within(nav).getByRole("button", { name: "Konto" }));

    expect(getTestLocation()).toEqual({ pathname: "/login", search: "?returnTo=%2Faccount" });
  });

  it.each([
    ["/", "Start"],
    ["/account", "Konto"],
    ["/profile", "Konto"],
  ])("logged in at %s: the bottom nav highlights %s", (path, tab) => {
    mockAuth = { token: "tok" };
    renderPublicPage(path);

    const nav = screen.getByRole("navigation", { name: "Nawigacja główna" });
    expect(within(nav).getByRole("button", { name: tab })).toHaveAttribute("aria-current", "true");
  });

  it("a page outside the panel sections highlights no tab", () => {
    renderPublicPage();

    const nav = screen.getByRole("navigation", { name: "Nawigacja główna" });
    for (const tab of within(nav).getAllByRole("button")) {
      expect(tab).not.toHaveAttribute("aria-current", "true");
    }
  });

  it("a chat thread keeps the top bar and the bottom nav but drops the search field", () => {
    mockAuth = { token: "tok" };
    renderPublicPage("/messages/7");

    expect(screen.getByRole("navigation", { name: "Menu konta" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Szukaj rzeczy i spotkań" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Nawigacja główna" })).toBeInTheDocument();
  });

  it("/login sits inside the layout with both global bars", () => {
    renderWithRoute(inLayout(<h1>Logowanie</h1>), {
      url: "/login",
      pattern: "/login",
      wrapper: createQueryWrapper(),
    });

    expect(screen.getByRole("navigation", { name: "Menu konta" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Nawigacja główna" })).toBeInTheDocument();
  });

  it("the top bar's search field leads to /search on every page", () => {
    renderPublicPage();

    expect(screen.getByRole("link", { name: "Szukaj rzeczy i spotkań" })).toHaveAttribute("href", "/search");
  });

  it("logged in: the top bar holds only the brand, Spotkania and the notification bell", async () => {
    mockAuth = { token: "tok", username: "ania" };
    renderPublicPage();

    const bar = screen.getByRole("navigation", { name: "Menu konta" });
    expect(await within(bar).findByRole("button", { name: "Powiadomienia" })).toBeInTheDocument();
    expect(within(bar).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/", "/meetings"]);
    expect(within(bar).getAllByRole("button")).toHaveLength(1);
    expect(notificationsApi.getMyNotifications).toHaveBeenCalled();
  });

  it("the logo is a named link to Start", () => {
    renderPublicPage();

    const bar = screen.getByRole("navigation", { name: "Menu konta" });
    expect(within(bar).getByRole("link", { name: "Krąg grupy — Start" })).toHaveAttribute("href", "/");
  });

  it("logged in: mounts the pending-actions host once, over the page", async () => {
    mockAuth = { token: "tok", username: "guest" };
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      {
        id: "5",
        kind: "TERM_CONFIRMATION_NEEDED",
        message: "Czy przekazanie „Pucio” doszło do skutku?",
        link_path: "/ania/group/5/term/9",
        read_at: null,
        created_at: "2026-03-01T10:00:00",
        reservation_id: null,
      },
    ]);
    renderPublicPage();

    expect(await screen.findAllByRole("dialog", { name: "Potwierdź przekazanie" })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Strona publiczna" })).toBeInTheDocument();
  });
});
