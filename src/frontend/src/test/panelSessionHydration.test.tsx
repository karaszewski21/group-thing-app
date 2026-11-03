import { ChakraProvider } from "@chakra-ui/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, screen } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionFromToken } from "../auth/session";
import { AuthProvider } from "../auth/AuthContext";
import { PanelGate } from "../features/panel/PanelGate";
import { ClientOnly } from "../routing/ClientOnly";
import { system } from "../theme/system";
import { getMockRouterCalls, resetMockNavigation } from "./navigationMock";
import { createTestQueryClient } from "./queryClient";

vi.mock("../features/landing/LandingPage", () => ({ LandingPage: () => <h1>Strona startowa</h1> }));
vi.mock("../features/panel/AppPage", () => ({ AppPage: () => <h1>Panel</h1> }));
vi.mock("../api/people", () => ({ getMyProfile: () => Promise.resolve({ display_name: "Ania" }) }));

const NOW_SECONDS = Math.floor(Date.now() / 1000);

function fakeJwt(exp: number): string {
  const payload = btoa(JSON.stringify({ sub: "ania@example.com", permissions: [], exp }));
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
}

function cookieToken(): string | null {
  const entry = document.cookie.split("; ").find((part) => part.startsWith("auth_token="));
  return entry ? decodeURIComponent(entry.slice("auth_token=".length)) : null;
}

/** The root layout's tree for the panel: the cookie seeds `initialToken`. */
function panelTree(initialToken: string) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <ChakraProvider value={system}>
        <AuthProvider initialSession={sessionFromToken(initialToken)}>
          <ClientOnly>
            <PanelGate>
              <p>Sekcja panelu</p>
            </PanelGate>
          </ClientOnly>
        </AuthProvider>
      </ChakraProvider>
    </QueryClientProvider>
  );
}

let root: Root | null = null;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("panel session on hydration", () => {
  it.each([
    { label: "an expired cookie at /", url: "/", exp: NOW_SECONDS - 60, heading: "Strona startowa", kept: false },
    { label: "an expired cookie at /home", url: "/home", exp: NOW_SECONDS - 60, heading: "Strona startowa", kept: false },
    { label: "a valid cookie at /home", url: "/home", exp: NOW_SECONDS + 3600, heading: "Panel", kept: true },
  ])("$label hydrates to the $heading without a login redirect", async ({ url, exp, heading, kept }) => {
    const jwt = fakeJwt(exp);
    document.cookie = `auth_token=${encodeURIComponent(jwt)}; Path=/`;
    resetMockNavigation(url);
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = renderToString(panelTree(jwt));
    const recoverableErrors: unknown[] = [];

    await act(async () => {
      root = hydrateRoot(container, panelTree(jwt), { onRecoverableError: (error) => recoverableErrors.push(error) });
    });

    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(recoverableErrors).toEqual([]);
    expect(getMockRouterCalls().filter((call) => call.method !== "refresh")).toEqual([]);
    const expectedToken = kept ? jwt : null;
    expect(localStorage.getItem("auth_token")).toBe(expectedToken);
    expect(cookieToken()).toBe(expectedToken);
  });
});
