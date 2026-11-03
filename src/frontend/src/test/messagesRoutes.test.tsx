import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PanelGate } from "../features/panel/PanelGate";
import { viewFromPath } from "../routing/paths";
import { pageFor } from "./appRoutes";
import { getTestLocation, renderWithRoute } from "./renderWithRoute";

let mockToken: string | null = "tok";
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: mockToken, username: "ania", permissions: [] }) }));
vi.mock("../features/panel/AppPage", () => ({ AppPage: () => <h1>Panel</h1> }));

/** `url` as the App Router serves it: a panel page, so the panel layout's gate. */
function renderAt(url: string) {
  renderWithRoute(<PanelGate />, { url, routes: { "/login": <p>Logowanie</p> } });
}

describe("panel routes moved out of (member)", () => {
  it.each([
    ["/messages", "(site)/(panel)/messages", "messages"],
    ["/messages/c42", "(site)/(panel)/messages/[conversationId]", "messages/thread"],
    ["/groups/g7", "(site)/(panel)/groups/[groupId]", "groups/details"],
    ["/terms/t9", "(site)/(panel)/terms/[termId]", "terms/attendees"],
    ["/organization", "(site)/(panel)/organization", "organization"],
  ])("%s is served by %s as the %s panel view", (url, dir, view) => {
    expect(pageFor(url)?.dir).toBe(dir);
    expect(viewFromPath(url)).toBe(view);
  });

  it.each([
    ["/groups/new", "groups/new"],
    ["/groups/g7/edit", "groups/edit"],
    ["/terms/t9/edit", "terms/edit"],
  ])("%s keeps its own view (%s), not the details view", (url, view) => {
    expect(viewFromPath(url)).toBe(view);
  });

  it("logged in: the thread renders inside the panel", async () => {
    mockToken = "tok";
    renderAt("/messages/c42");
    expect(await screen.findByRole("heading", { name: "Panel" })).toBeInTheDocument();
  });

  it("logged out: the inbox redirects to the login page", async () => {
    mockToken = null;
    renderAt("/messages");
    await waitFor(() => expect(getTestLocation().pathname).toBe("/login"));
    expect(screen.queryByRole("heading", { name: "Panel" })).not.toBeInTheDocument();
  });
});
