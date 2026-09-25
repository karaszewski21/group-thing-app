import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError } from "../api/client";
import * as organizationsApi from "../api/organizations";
import type { OrganizationResponse } from "../api/organizations";
import { PublicLayout } from "../components/layout/PublicLayout";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/organizations", () => ({ getMyOrganization: vi.fn() }));

let mockAuth: { token: string | null };
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
  mockAuth = { token: null };
  vi.mocked(organizationsApi.getMyOrganization).mockRejectedValue(new ApiError(404, "Not Found", null));
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
    expect(within(menu).getByRole("menuitem", { name: /Mój dom/ })).toHaveAttribute("href", "/panel/rodzina");
    expect(within(menu).getByRole("menuitem", { name: /Moja organizacja/ })).toHaveAttribute("href", "/organization");
  });

  it("logged in with an Organization: 'Moja organizacja' links to its public page", async () => {
    mockAuth = { token: "tok" };
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue({ slug: "moja-org" } as OrganizationResponse);
    renderPublicPage();

    const menu = await openMenu();
    await waitFor(() =>
      expect(within(menu).getByRole("menuitem", { name: /Moja organizacja/ })).toHaveAttribute("href", "/moja-org"),
    );
  });

  it("picking a menu item closes the menu", async () => {
    mockAuth = { token: "tok" };
    renderPublicPage();

    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Profil/ }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
