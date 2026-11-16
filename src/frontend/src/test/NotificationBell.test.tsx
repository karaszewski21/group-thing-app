import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as notificationsApi from "../api/notifications";
import type { NotificationResponse } from "../api/notifications";
import { NotificationBell } from "../components/shared/NotificationBell";
import { createQueryWrapper } from "./queryClient";
import { getTestLocation, renderWithRoute } from "./renderWithRoute";

vi.mock("../api/notifications", () => ({
  getMyNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "tok", username: "ania" }) }));

const notif = (over: Partial<NotificationResponse> = {}): NotificationResponse => ({
  id: "1",
  kind: "PLEDGE_CREATED",
  message: "„Kasia\" zadeklarował(a) przyniesienie: Bębenek",
  link_path: "/ania/group/5/term/3",
  read_at: null,
  created_at: "2026-03-01T10:00:00",
  reservation_id: null,
  ...over,
});

function renderBell() {
  return renderWithRoute(<NotificationBell />, {
    url: "/",
    pattern: "/",
    routes: { "/ania/group/5/term/3": <h1>Strona terminu</h1> },
    wrapper: createQueryWrapper(),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("NotificationBell", () => {
  it("shows an unread badge and lists messages in the dropdown", async () => {
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([notif(), notif({ id: "2" })]);
    renderBell();

    fireEvent.click(await screen.findByRole("button", { name: "Powiadomienia (2 nieprzeczytane)" }));

    expect(screen.getAllByRole("menuitem", { name: /zadeklarował\(a\) przyniesienie: Bębenek/ })).toHaveLength(2);
  });

  it("clicking a notification marks it read and navigates to its link_path", async () => {
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([notif()]);
    vi.mocked(notificationsApi.markNotificationRead).mockResolvedValue(undefined);
    renderBell();

    fireEvent.click(await screen.findByRole("button", { name: /Powiadomienia/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /zadeklarował\(a\)/ }));

    await waitFor(() => expect(notificationsApi.markNotificationRead).toHaveBeenCalledWith("1"));
    expect(await screen.findByRole("heading", { name: "Strona terminu" })).toBeInTheDocument();
  });

  it("'Oznacz jako przeczytane' calls markAllNotificationsRead and clears the badge", async () => {
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([notif()]);
    vi.mocked(notificationsApi.markAllNotificationsRead).mockResolvedValue(undefined);
    renderBell();

    fireEvent.click(await screen.findByRole("button", { name: "Powiadomienia (1 nieprzeczytane)" }));
    fireEvent.click(screen.getByRole("button", { name: "Oznacz jako przeczytane" }));

    await waitFor(() => expect(notificationsApi.markAllNotificationsRead).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Powiadomienia" })).toBeInTheDocument();
  });

  it("renders a RESERVATION_CANCELLED notification", async () => {
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      notif({
        kind: "RESERVATION_CANCELLED",
        message: "Wydarzenie „Kiermasz rzeczy” zostało usunięte — rezerwacja „Rowerek” anulowana",
        link_path: "/product/item-1",
      }),
    ]);
    renderBell();

    fireEvent.click(await screen.findByRole("button", { name: "Powiadomienia (1 nieprzeczytane)" }));

    expect(screen.getByRole("menuitem", { name: /rezerwacja „Rowerek” anulowana/ })).toBeInTheDocument();
  });

  it("renders the three wants rows and follows each one's link", async () => {
    const rows = [
      notif({
        id: "w1",
        kind: "WANT_MATCH_FOUND",
        message: "Szukasz: «rowerek biegowy». Ktoś wystawił: «Rowerek biegowy Puky».",
        link_path: "/ania/product/item-1",
      }),
      notif({
        id: "w2",
        kind: "WANT_MATCH_FOUND",
        message: "Szukasz: «kurtka zimowa 110». 3 nowe pasujące rzeczy.",
        link_path: "/wanted/want-2",
      }),
      notif({
        id: "w3",
        kind: "WANT_EXPIRING",
        message: "Poszukiwanie «fotelik samochodowy» wygaśnie za 7 dni. Przedłuż je, jeśli nadal szukasz.",
        link_path: "/wanted/want-3",
      }),
    ];
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue(rows);
    vi.mocked(notificationsApi.markNotificationRead).mockResolvedValue(undefined);
    renderWithRoute(<NotificationBell />, { url: "/", wrapper: createQueryWrapper() });

    fireEvent.click(await screen.findByRole("button", { name: "Powiadomienia (3 nieprzeczytane)" }));
    expect(screen.getAllByRole("menuitem").map((row) => row.textContent)).toEqual(rows.map((row) => row.message));

    for (const row of rows) {
      if (!screen.queryByRole("menu")) fireEvent.click(screen.getByRole("button", { name: /Powiadomienia/ }));
      fireEvent.click(screen.getByRole("menuitem", { name: row.message }));
      await waitFor(() => expect(getTestLocation().pathname).toBe(row.link_path));
    }
    expect(notificationsApi.markNotificationRead).toHaveBeenCalledTimes(3);
  });

  it("shows no badge and an empty state when there is nothing unread", async () => {
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([]);
    renderBell();

    fireEvent.click(await screen.findByRole("button", { name: "Powiadomienia" }));

    expect(screen.getByText("Brak powiadomień")).toBeInTheDocument();
  });
});
