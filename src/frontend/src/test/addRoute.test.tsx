import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router-dom";
import { routes } from "../router";

let mockToken: string | null = null;
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: mockToken, username: null, permissions: [] }) }));
vi.mock("../components/layout/PublicLayout", () => ({ PublicLayout: () => <Outlet /> }));
vi.mock("../pages/home/AppPage", () => ({ AppPage: () => <h1>Panel</h1> }));

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe("/add route", () => {
  it("logged out: shows the four tiles, each leading to the login page and back to its form", async () => {
    mockToken = null;
    renderAt("/add");

    expect(await screen.findByRole("heading", { name: "Co dodajesz?" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Rzecz/ })).toHaveAttribute("href", "/login?returnTo=%2Fadd%2Fproduct");
    expect(screen.getByRole("link", { name: /^Szukam rzeczy/ })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fadd%2Fhunting",
    );
    expect(screen.getByRole("link", { name: /^Termin spotkania/ })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fadd%2Fterm",
    );
    expect(screen.getByRole("link", { name: /^Wydarzenie/ })).toHaveAttribute("href", "/login?returnTo=%2Fadd%2Fevent");
    expect(screen.queryByRole("heading", { name: "Panel" })).not.toBeInTheDocument();
  });

  it("logged out: the add forms themselves still require logging in", async () => {
    mockToken = null;
    const router = renderAt("/add/product");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  });

  it("logged in: /add is the panel view", async () => {
    mockToken = "tok";
    renderAt("/add");
    expect(await screen.findByRole("heading", { name: "Panel" })).toBeInTheDocument();
  });
});
