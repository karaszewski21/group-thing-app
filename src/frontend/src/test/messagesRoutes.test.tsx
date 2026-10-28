import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMemoryRouter, Outlet, RouterProvider, useParams } from "react-router-dom";
import { routes } from "../router";

let mockToken: string | null = "tok";
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: mockToken, username: "ania", permissions: [] }) }));
vi.mock("../components/layout/PublicLayout", () => ({ PublicLayout: () => <Outlet /> }));
vi.mock("../pages/home/AppPage", () => ({ AppPage: () => <h1>Panel</h1> }));
vi.mock("../pages/messages/InboxPage", () => ({ InboxPage: () => <h1>Skrzynka</h1> }));
vi.mock("../pages/messages/ThreadPage", () => ({
  ThreadPage: function ThreadStub() {
    return <h1>Rozmowa {useParams().conversationId}</h1>;
  },
}));

function renderAt(path: string) {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

describe("messages routes", () => {
  it("/messages renders the inbox, not the panel", async () => {
    mockToken = "tok";
    renderAt("/messages");
    expect(await screen.findByRole("heading", { name: "Skrzynka" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Panel" })).not.toBeInTheDocument();
  });

  it("/messages/:conversationId renders the thread", async () => {
    mockToken = "tok";
    renderAt("/messages/c42");
    expect(await screen.findByRole("heading", { name: "Rozmowa c42" })).toBeInTheDocument();
  });

  it("logged out: the inbox redirects to the login page", async () => {
    mockToken = null;
    const router = createMemoryRouter(routes, { initialEntries: ["/messages"] });
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(screen.queryByRole("heading", { name: "Skrzynka" })).not.toBeInTheDocument();
  });
});
