import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AuthGuard } from "../auth/AuthGuard";
import * as conversationsApi from "../api/conversations";
import * as notificationsApi from "../api/notifications";
import { PublicLayout } from "../components/layout/PublicLayout";
import { createQueryWrapper } from "./queryClient";
import { resetSnoozeStoreForTests } from "../components/pending/snoozeStore";

vi.mock("../api/conversations", () => ({ getUnreadMessageCount: vi.fn(), chatErrorMessage: vi.fn() }));
vi.mock("../api/notifications", () => ({
  getMyNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

let mockAuth: { token: string | null; username?: string };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

function renderPublicPage(initialEntry = "/skrzaty") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<h1>Start</h1>} />
          <Route path="/konto" element={<AuthGuard><h1>Konto</h1></AuthGuard>} />
          <Route path="/profil" element={<h1>Profil</h1>} />
          <Route path="/wiadomosci/:conversationId" element={<h1>Wątek</h1>} />
          <Route path="/:organizationSlug" element={<h1>Strona publiczna</h1>} />
        </Route>
        <Route path="/login" element={<h1>Logowanie</h1>} />
      </Routes>
    </MemoryRouter>,
    { wrapper: createQueryWrapper() },
  );
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
    expect(within(bar).getByRole("link", { name: "Spotkania" })).toHaveAttribute("href", "/spotkania");
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

    expect(screen.getByTestId("where")).toHaveTextContent("/login?returnTo=%2Fkonto");
  });

  it.each([
    ["/", "Start"],
    ["/konto", "Konto"],
    ["/profil", "Konto"],
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

  it("a chat thread keeps the top bar but drops the search field and the bottom nav", () => {
    mockAuth = { token: "tok" };
    renderPublicPage("/wiadomosci/7");

    expect(screen.getByRole("navigation", { name: "Menu konta" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Szukaj rzeczy i spotkań" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Nawigacja główna" })).not.toBeInTheDocument();
  });

  it("/login sits inside the layout with both global bars", () => {
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/login" element={<h1>Logowanie</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>,
      { wrapper: createQueryWrapper() },
    );

    expect(screen.getByRole("navigation", { name: "Menu konta" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Nawigacja główna" })).toBeInTheDocument();
  });

  it("the top bar's search field leads to /szukaj on every page", () => {
    renderPublicPage();

    expect(screen.getByRole("link", { name: "Szukaj rzeczy i spotkań" })).toHaveAttribute("href", "/szukaj");
  });

  it("logged in: the top bar holds only the brand, Spotkania and the notification bell", async () => {
    mockAuth = { token: "tok", username: "ania" };
    renderPublicPage();

    const bar = screen.getByRole("navigation", { name: "Menu konta" });
    expect(await within(bar).findByRole("button", { name: "Powiadomienia" })).toBeInTheDocument();
    expect(within(bar).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/", "/spotkania"]);
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
        link_path: "/ania/grupa/5/term/9",
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
