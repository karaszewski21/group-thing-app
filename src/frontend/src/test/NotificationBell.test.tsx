import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import * as notificationsApi from "../api/notifications";
import type { NotificationResponse } from "../api/notifications";
import { NotificationBell } from "../components/shared/NotificationBell";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/notifications", () => ({
  getMyNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "tok", username: "ania" }) }));

const notif = (over: Partial<NotificationResponse> = {}): NotificationResponse => ({
  id: 1,
  kind: "PLEDGE_CREATED",
  message: "„Kasia\" zadeklarował(a) przyniesienie: Bębenek",
  link_path: "/ania/grupa/5/term/3",
  read_at: null,
  created_at: "2026-03-01T10:00:00",
  reservation_id: null,
  ...over,
});

function renderBell() {
  return render(
    <MemoryRouter initialEntries={["/panel"]}>
      <Routes>
        <Route path="/panel" element={<NotificationBell />} />
        <Route path="/ania/grupa/5/term/3" element={<h1>Strona terminu</h1>} />
      </Routes>
    </MemoryRouter>,
    { wrapper: createQueryWrapper() },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("NotificationBell", () => {
  it("shows an unread badge and lists messages in the dropdown", async () => {
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([notif(), notif({ id: 2 })]);
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

    await waitFor(() => expect(notificationsApi.markNotificationRead).toHaveBeenCalledWith(1));
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

  it("shows no badge and an empty state when there is nothing unread", async () => {
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([]);
    renderBell();

    fireEvent.click(await screen.findByRole("button", { name: "Powiadomienia" }));

    expect(screen.getByText("Brak powiadomień")).toBeInTheDocument();
  });
});
