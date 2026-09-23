import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AuthGuard } from "../auth/AuthGuard";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ token: "valid.jwt.token" }),
}));

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname + location.search}</div>;
}

function renderAt(initialRoute: string) {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route
          path="/register"
          element={
            <AuthGuard requireAuth={false} authenticatedRedirect="/onboarding" forwardReturnTo>
              <div>REGISTER</div>
            </AuthGuard>
          }
        />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AuthGuard forwardReturnTo", () => {
  it("sends a logged-in visitor to onboarding with the returnTo carried along, not straight to it", () => {
    renderAt(`/register?returnTo=${encodeURIComponent("/zajecia/grupa/7/term/9")}`);
    expect(screen.getByTestId("where")).toHaveTextContent(
      `/onboarding?returnTo=${encodeURIComponent("/zajecia/grupa/7/term/9")}`,
    );
  });

  it("without returnTo goes to the plain authenticatedRedirect", () => {
    renderAt("/register");
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/onboarding$/);
  });
});
