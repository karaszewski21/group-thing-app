import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import GroupDetailsRoute from "../app/(site)/(panel)/groups/[groupId]/page";
import InboxRoute from "../app/(site)/(panel)/messages/page";
import OrganizationRoute from "../app/(site)/(panel)/organization/page";
import TermAttendeesRoute from "../app/(site)/(panel)/terms/[termId]/attendees/page";
import ThreadRoute from "../app/(site)/(panel)/messages/[conversationId]/page";
import { PanelGate } from "../features/panel/PanelGate";
import { pageFor } from "./appRoutes";
import { getTestLocation, renderWithRoute } from "./renderWithRoute";

let mockToken: string | null = "tok";
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: mockToken, username: "ania", permissions: [] }) }));
vi.mock("../features/panel/AppPage", () => ({
  AppPage: ({ children }: { children: ReactNode }) => <div data-testid="panel">{children}</div>,
}));
vi.mock("../features/messages/InboxPage", () => ({ InboxPage: () => <h1>Skrzynka</h1> }));
vi.mock("../features/messages/ThreadPage", () => ({ ThreadPage: () => <h1>Rozmowa</h1> }));
vi.mock("../features/groups/GroupDetailsPage", () => ({ GroupDetailsPage: () => <h1>Grupa</h1> }));
vi.mock("../features/meetings/TermAttendeesPage", () => ({ TermAttendeesPage: () => <h1>Zapisani</h1> }));
vi.mock("../features/owner-page/OrganizationPage", () => ({ OrganizationPage: () => <h1>Organizacja</h1> }));

describe("panel section pages", () => {
  it.each([
    ["/messages", "(site)/(panel)/messages", InboxRoute, "Skrzynka"],
    ["/groups/g7", "(site)/(panel)/groups/[groupId]", GroupDetailsRoute, "Grupa"],
    ["/terms/t9/attendees", "(site)/(panel)/terms/[termId]/attendees", TermAttendeesRoute, "Zapisani"],
    ["/organization", "(site)/(panel)/organization", OrganizationRoute, "Organizacja"],
  ])("%s is a panel page that renders its own view", (url, dir, Route, heading) => {
    expect(pageFor(url)?.dir).toBe(dir);
    render(<Route />);
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
  });

  it("the chat thread is a panel page too", () => {
    expect(pageFor("/messages/c42")?.dir).toBe("(site)/(panel)/messages/[conversationId]");
    render(<ThreadRoute />);
    expect(screen.getByRole("heading", { name: "Rozmowa" })).toBeInTheDocument();
  });

  it("logged in: the gate renders the section page inside the panel frame", async () => {
    mockToken = "tok";
    renderWithRoute(
      <PanelGate>
        <InboxRoute />
      </PanelGate>,
      { url: "/messages", pattern: "/messages" },
    );
    expect(await screen.findByTestId("panel")).toContainElement(screen.getByRole("heading", { name: "Skrzynka" }));
  });

  it("logged out: the inbox redirects to the login page", async () => {
    mockToken = null;
    renderWithRoute(
      <PanelGate>
        <InboxRoute />
      </PanelGate>,
      { url: "/messages", pattern: "/messages", routes: { "/login": <p>Logowanie</p> } },
    );
    await waitFor(() => expect(getTestLocation().pathname).toBe("/login"));
    expect(screen.queryByRole("heading", { name: "Skrzynka" })).not.toBeInTheDocument();
  });
});
