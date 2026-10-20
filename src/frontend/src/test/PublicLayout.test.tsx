import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError } from "../api/client";
import * as notificationsApi from "../api/notifications";
import * as groupsApi from "../api/groups";
import * as organizationsApi from "../api/organizations";
import type { MyOrganizationResponse } from "../api/organizations";
import { PublicLayout } from "../components/layout/PublicLayout";
import { createQueryWrapper } from "./queryClient";
import { resetSnoozeStoreForTests } from "../components/pending/snoozeStore";

vi.mock("../api/organizations", () => ({ getMyOrganization: vi.fn() }));
vi.mock("../api/notifications", () => ({
  getMyNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

vi.mock("../api/groups", () => ({
  listMyPendingJoinRequests: vi.fn(),
  approveJoinRequest: vi.fn(),
  rejectJoinRequest: vi.fn(),
}));

let mockAuth: { token: string | null; username?: string };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

function renderPublicPage() {
  return render(
    <MemoryRouter initialEntries={["/skrzaty"]}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/:organizationSlug" element={<h1>Strona publiczna</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
    { wrapper: createQueryWrapper() },
  );
}

async function openMenu() {
  fireEvent.click(await screen.findByRole("button", { name: "Menu" }));
  return screen.getByRole("menu");
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  resetSnoozeStoreForTests();
  mockAuth = { token: null };
  vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([]);
  vi.mocked(organizationsApi.getMyOrganization).mockRejectedValue(new ApiError(404, "Not Found", null));
  vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([]);
});

describe("PublicLayout", () => {
  it("anonymous: renders the page with no account bar", () => {
    renderPublicPage();

    expect(screen.getByRole("heading", { name: "Strona publiczna" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Menu konta" })).not.toBeInTheDocument();
    expect(organizationsApi.getMyOrganization).not.toHaveBeenCalled();
  });

  it("logged in: the bar's menu links back to the Panel sections, organization falls back to the create form", async () => {
    mockAuth = { token: "tok" };
    renderPublicPage();

    expect(screen.getByRole("heading", { name: "Strona publiczna" })).toBeInTheDocument();
    const menu = await openMenu();
    expect(within(menu).getByRole("menuitem", { name: /Mój panel/ })).toHaveAttribute("href", "/panel");
    expect(within(menu).getByRole("menuitem", { name: /Profil/ })).toHaveAttribute("href", "/panel/profil");
    expect(within(menu).getByRole("menuitem", { name: /Ustawienia/ })).toHaveAttribute("href", "/panel/ustawienia");
    expect(within(menu).getByRole("menuitem", { name: /Moje miejsca/ })).toHaveAttribute("href", "/panel/miejsca");
    expect(within(menu).getByRole("menuitem", { name: /Mój dom/ })).toHaveAttribute("href", "/panel/rodzina");
    expect(within(menu).getByRole("menuitem", { name: /Moja organizacja/ })).toHaveAttribute("href", "/organization");
    expect(within(menu).getByRole("menuitem", { name: /Załóż grupę/ })).toHaveAttribute(
      "href",
      "/panel/spotkania?nowa=grupa",
    );
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent?.trim())).toEqual([
      "Mój panel",
      "Profil",
      "Ustawienia",
      "Moje miejsca",
      "Załóż grupę",
      "Moja organizacja",
      "Mój dom",
    ]);
  });

  it("logged in with an Organization: 'Moja organizacja' links to its public page", async () => {
    mockAuth = { token: "tok" };
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue({ slug: "moja-org" } as MyOrganizationResponse);
    renderPublicPage();

    const menu = await openMenu();
    await waitFor(() =>
      expect(within(menu).getByRole("menuitem", { name: /Moja organizacja/ })).toHaveAttribute("href", "/moja-org"),
    );
  });

  it("logged in: the bar shows the notification bell next to the menu", async () => {
    mockAuth = { token: "tok" };
    renderPublicPage();

    expect(await screen.findByRole("button", { name: "Powiadomienia" })).toBeInTheDocument();
    expect(notificationsApi.getMyNotifications).toHaveBeenCalled();
  });

  it("picking a menu item closes the menu", async () => {
    mockAuth = { token: "tok" };
    renderPublicPage();

    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Profil/ }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
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
    expect(groupsApi.listMyPendingJoinRequests).toHaveBeenCalledTimes(1);
  });

  it("anonymous: no pending-actions host and no join-request fetch", () => {
    renderPublicPage();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(groupsApi.listMyPendingJoinRequests).not.toHaveBeenCalled();
  });
});
