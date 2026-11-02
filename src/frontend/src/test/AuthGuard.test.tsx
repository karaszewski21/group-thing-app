import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../auth/AuthGuard";
import { homePath } from "../auth/homePath";
import { getTestLocation, renderWithRoute } from "./renderWithRoute";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ token: "valid.jwt.token" }),
}));

function where() {
  const { pathname, search } = getTestLocation();
  return pathname + search;
}

function renderAt(initialRoute: string) {
  return renderWithRoute(
    <AuthGuard requireAuth={false} authenticatedRedirect="/onboarding" forwardReturnTo>
      <div>REGISTER</div>
    </AuthGuard>,
    { url: initialRoute, pattern: "/register" },
  );
}

describe("AuthGuard forwardReturnTo", () => {
  it("sends a logged-in visitor to onboarding with the returnTo carried along, not straight to it", () => {
    renderAt(`/register?returnTo=${encodeURIComponent("/zajecia/group/7/term/9")}`);
    expect(where()).toBe(`/onboarding?returnTo=${encodeURIComponent("/zajecia/group/7/term/9")}`);
    expect(screen.queryByText("REGISTER")).not.toBeInTheDocument();
  });

  it("without returnTo goes to the plain authenticatedRedirect", () => {
    renderAt("/register");
    expect(where()).toBe("/onboarding");
    expect(screen.queryByText("REGISTER")).not.toBeInTheDocument();
  });
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
