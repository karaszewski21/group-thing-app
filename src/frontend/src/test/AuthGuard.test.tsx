import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../auth/AuthGuard";
import { homePath } from "../auth/homePath";
import { getTestLocation, renderWithRoute } from "./renderWithRoute";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ token: "valid.jwt.token", permissions: [] }),
}));

function where() {
  const { pathname, search } = getTestLocation();
  return pathname + search;
}

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
    expect(where()).toBe("/zajecia/group/7/term/9");
    expect(screen.queryByText("LOGIN")).not.toBeInTheDocument();
  });

  it("without returnTo goes to the role's home", () => {
    renderAt("/login");
    expect(where()).toBe("/");
    expect(screen.queryByText("LOGIN")).not.toBeInTheDocument();
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example"])(
    "ignores returnTo=%s and goes to the role's home",
    (returnTo) => {
      renderAt(`/login?returnTo=${encodeURIComponent(returnTo)}`);
      expect(where()).toBe("/");
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
