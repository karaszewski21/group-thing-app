import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as wantsApi from "../api/wants";
import { AddView, PublicAddView } from "../features/add/AddView";
import { PanelGate } from "../features/panel/PanelGate";
import { pageFor } from "./appRoutes";
import { makeWant } from "./fixtures/wants";
import { createQueryWrapper } from "./queryClient";
import { getTestLocation, renderWithRoute } from "./renderWithRoute";

let mockToken: string | null = null;
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: mockToken, username: null, permissions: [] }) }));
vi.mock("../features/panel/AppPage", () => ({ AppPage: () => <h1>Panel</h1> }));
vi.mock("../features/panel/appDataStore", () => ({ useAppData: () => ({ myGroups: [] }) }));
vi.mock("../api/wants", () => ({ getMyWants: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(wantsApi.getMyWants).mockResolvedValue([]);
});

/** `url` as the App Router serves it: a panel page, so the panel layout's gate. */
function renderAt(url: string) {
  expect(pageFor(url)?.dir).toBe(`(site)/(panel)${url}`);
  renderWithRoute(<PanelGate>{null}</PanelGate>, { url, routes: { "/login": <p>Logowanie</p> } });
}

describe("/add route", () => {
  it("logged out: shows the four tiles, each leading to the login page and back to its form", async () => {
    mockToken = null;
    renderAt("/add");

    expect(await screen.findByRole("heading", { name: "Co dodajesz?" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Rzecz/ })).toHaveAttribute("href", "/login?returnTo=%2Fadd%2Fproduct");
    expect(screen.getByRole("link", { name: /^Szukam rzeczy/ })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fadd%2Fwanted",
    );
    expect(screen.getByRole("link", { name: /^Szukam rzeczy/ })).toHaveTextContent(
      "Damy znać, gdy ktoś doda pasującą",
    );
    expect(screen.getByRole("link", { name: /^Termin spotkania/ })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fadd%2Fterm",
    );
    expect(screen.getByRole("link", { name: /^Wydarzenie/ })).toHaveAttribute("href", "/login?returnTo=%2Fadd%2Fevent");
    expect(screen.queryByRole("heading", { name: "Panel" })).not.toBeInTheDocument();
    expect(wantsApi.getMyWants).not.toHaveBeenCalled();
  });

  it("logged out: the tiles ask for no wants and show no count, even with a query client around", async () => {
    mockToken = null;
    vi.mocked(wantsApi.getMyWants).mockResolvedValue([makeWant({ match_count: 2, new_match_count: 2 })]);
    renderWithRoute(<PublicAddView />, { url: "/add", wrapper: createQueryWrapper() });

    const tile = await screen.findByRole("link", { name: /^Szukam rzeczy/ });
    expect(tile).not.toHaveTextContent(/now/);
    expect(wantsApi.getMyWants).not.toHaveBeenCalled();
  });

  it("logged in: the Szukam rzeczy tile leads to /add/wanted with the summed new matches of the active wants", async () => {
    mockToken = "tok";
    vi.mocked(wantsApi.getMyWants).mockResolvedValue([
      makeWant({ match_count: 4, new_match_count: 3 }),
      makeWant({ id: "want-2", match_count: 2, new_match_count: 2 }),
      makeWant({ id: "want-3", status: "EXPIRED", match_count: 1, new_match_count: 1 }),
    ]);
    renderWithRoute(<AddView />, { url: "/add", wrapper: createQueryWrapper() });

    const tile = await screen.findByRole("link", { name: /^Szukam rzeczy/ });
    await waitFor(() => expect(tile).toHaveTextContent("5 nowych"));
    expect(tile).toHaveAttribute("href", "/add/wanted");
  });

  it("logged in: the tile has no pill while no match is new", async () => {
    mockToken = "tok";
    vi.mocked(wantsApi.getMyWants).mockResolvedValue([makeWant({ match_count: 4 })]);
    renderWithRoute(<AddView />, { url: "/add", wrapper: createQueryWrapper() });

    await waitFor(() => expect(wantsApi.getMyWants).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: /^Szukam rzeczy/ })).not.toHaveTextContent(/now/);
  });

  it("logged out: the add forms themselves still require logging in", async () => {
    mockToken = null;
    renderAt("/add/product");
    await waitFor(() => expect(getTestLocation().pathname).toBe("/login"));
  });

  it("logged in: /add is the panel view", async () => {
    mockToken = "tok";
    renderAt("/add");
    expect(await screen.findByRole("heading", { name: "Panel" })).toBeInTheDocument();
  });
});
