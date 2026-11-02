import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MemberLayout from "../app/(site)/(member)/layout";
import InboxRoute from "../app/(site)/(member)/messages/page";
import ThreadRoute from "../app/(site)/(member)/messages/[conversationId]/page";
import { useAppParams } from "../routing/navigation";
import { pageFor } from "./appRoutes";
import { getTestLocation, renderWithRoute } from "./renderWithRoute";

let mockToken: string | null = "tok";
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: mockToken, username: "ania", permissions: [] }) }));
vi.mock("../features/messages/InboxPage", () => ({ InboxPage: () => <h1>Skrzynka</h1> }));
vi.mock("../features/messages/ThreadPage", () => ({
  ThreadPage: function ThreadStub() {
    return <h1>Rozmowa {useAppParams().conversationId}</h1>;
  },
}));

/** The member pages under their layout, as the App Router serves `url`. */
function renderAt(url: string) {
  renderWithRoute(<></>, {
    url,
    routes: {
      "/messages": (
        <MemberLayout>
          <InboxRoute />
        </MemberLayout>
      ),
      "/messages/:conversationId": (
        <MemberLayout>
          <ThreadRoute />
        </MemberLayout>
      ),
      "/login": <p>Logowanie</p>,
    },
  });
}

describe("messages routes", () => {
  it("/messages renders the inbox, not the panel", async () => {
    mockToken = "tok";
    expect(pageFor("/messages")?.dir).toBe("(site)/(member)/messages");
    renderAt("/messages");
    expect(await screen.findByRole("heading", { name: "Skrzynka" })).toBeInTheDocument();
  });

  it("/messages/:conversationId renders the thread", async () => {
    mockToken = "tok";
    expect(pageFor("/messages/c42")?.dir).toBe("(site)/(member)/messages/[conversationId]");
    renderAt("/messages/c42");
    expect(await screen.findByRole("heading", { name: "Rozmowa c42" })).toBeInTheDocument();
  });

  it("logged out: the inbox redirects to the login page", async () => {
    mockToken = null;
    renderAt("/messages");
    await waitFor(() => expect(getTestLocation().pathname).toBe("/login"));
    expect(screen.queryByRole("heading", { name: "Skrzynka" })).not.toBeInTheDocument();
  });
});
