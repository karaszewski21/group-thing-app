import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../auth/AuthGuard";
import { homePath } from "../auth/homePath";
import { replaceDocument } from "../routing/documentNavigation";
import { getTestRouter, renderWithRoute } from "./renderWithRoute";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ token: "valid.jwt.token", permissions: [] }),
}));

vi.mock("../routing/documentNavigation", () => ({ replaceDocument: vi.fn() }));

beforeEach(() => {
  vi.mocked(replaceDocument).mockReset();
});

function renderAt(initialRoute: string) {
  return renderWithRoute(
    <AuthGuard requireAuth={false}>
      <div>LOGIN</div>
    </AuthGuard>,
    { url: initialRoute, pattern: "/login" },
  );
}

describe("AuthGuard requireAuth={false}", () => {
  it("sends a logged-in visitor straight to a safe returnTo", () => {
    renderAt(`/login?returnTo=${encodeURIComponent("/zajecia/group/7/term/9")}`);
    expect(replaceDocument).toHaveBeenCalledExactlyOnceWith("/zajecia/group/7/term/9");
    expect(screen.queryByText("LOGIN")).not.toBeInTheDocument();
  });

  // The client router keeps a protected URL's route as the proxy answered a
  // guest (a redirect to /login); a client navigation would replay it.
  it("leaves the client router: a full page load, no router navigation", () => {
    renderAt(`/login?returnTo=${encodeURIComponent("/add/wanted?name=kask&radius=10")}`);
    expect(replaceDocument).toHaveBeenCalledExactlyOnceWith("/add/wanted?name=kask&radius=10");
    expect(getTestRouter().calls).toEqual([]);
  });

  it("without returnTo goes to the role's home", () => {
    renderAt("/login");
    expect(replaceDocument).toHaveBeenCalledExactlyOnceWith("/");
    expect(screen.queryByText("LOGIN")).not.toBeInTheDocument();
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example"])(
    "ignores returnTo=%s and goes to the role's home",
    (returnTo) => {
      renderAt(`/login?returnTo=${encodeURIComponent(returnTo)}`);
      expect(replaceDocument).toHaveBeenCalledExactlyOnceWith("/");
    },
  );
});

describe("homePath", () => {
  it.each([
    [["ADMIN"], "/admin/products"],
    [["EDIT", "PLUGIN_MANAGEMENT"], "/admin/products"],
    [["EDIT"], "/"],
    [[], "/"],
  ])("permissions %j land on %s", (permissions, expected) => {
    expect(homePath(permissions)).toBe(expected);
  });
});
