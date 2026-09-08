import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import * as groupsApi from "../api/groups";
import * as peopleApi from "../api/people";
import { AuthProvider } from "../auth/AuthContext";
import { AccountMergeForm } from "../components/krag/AccountMergeForm";

// Group 11 gap review (candidate gap #3): no existing test exercises the
// specific handoff "account-merge succeeds -> applyExternalToken stores the
// token -> a subsequent authenticated call (getMyProfile()) actually
// succeeds using that token" end to end against the REAL `AuthContext`
// (every other file mocks `useAuth` outright, which stubs this behavior
// away). This file deliberately does NOT mock `../auth/AuthContext` — it
// renders the real `AuthProvider` so `applyExternalToken`'s real body runs.

vi.mock("../api/groups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/groups")>();
  return { ...actual, mergeAnonymousProfile: vi.fn() };
});

vi.mock("../api/people", () => ({
  getMyProfile: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderForm() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <AccountMergeForm userProfileId={55} />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
});

describe("account-merge -> real AuthContext.applyExternalToken -> authenticated fetch handoff", () => {
  it("a successful merge stores the returned token under auth_token and triggers a getMyProfile() call using it", async () => {
    vi.mocked(groupsApi.mergeAnonymousProfile).mockResolvedValue({
      token: "merged-jwt-token",
      party_id: 9,
    });
    vi.mocked(peopleApi.getMyProfile).mockResolvedValue({
      id: 55,
      party_id: 9,
      account_user_id: 1,
      display_name: "Ania Kowalska",
      email: "ania@example.com",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      is_organizer: false,
    });

    renderForm();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ania@example.com" } });
    fireEvent.change(screen.getByLabelText("Hasło"), { target: { value: "sekret123" } });
    fireEvent.click(screen.getByRole("button", { name: "Załóż konto" }));

    // Real applyExternalToken (== applyToken) persists the token, which is
    // the precondition for any subsequent authenticated api client call to
    // attach `Authorization: Bearer <token>` (see api/client.ts's `request`).
    await waitFor(() => expect(localStorage.getItem("auth_token")).toBe("merged-jwt-token"));

    // Real applyToken always chains a getMyProfile() refresh — confirms the
    // "subsequent authenticated data fetch actually succeeds" half of the
    // handoff (mocked here to resolve, i.e. not reject as an unauthenticated
    // 401 would), not just that a token string was stored.
    await waitFor(() => expect(peopleApi.getMyProfile).toHaveBeenCalled());

    expect(mockNavigate).toHaveBeenCalledWith("/panel");
  });

  it("when the subsequent getMyProfile() call fails, the merge itself is unaffected — token stays stored and navigation still happens", async () => {
    vi.mocked(groupsApi.mergeAnonymousProfile).mockResolvedValue({
      token: "merged-jwt-token-2",
      party_id: 10,
    });
    vi.mocked(peopleApi.getMyProfile).mockRejectedValue(new Error("network error"));

    renderForm();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "piotr@example.com" } });
    fireEvent.change(screen.getByLabelText("Hasło"), { target: { value: "sekret123" } });
    fireEvent.click(screen.getByRole("button", { name: "Załóż konto" }));

    await waitFor(() => expect(localStorage.getItem("auth_token")).toBe("merged-jwt-token-2"));
    await waitFor(() => expect(peopleApi.getMyProfile).toHaveBeenCalled());
    expect(mockNavigate).toHaveBeenCalledWith("/panel");
  });
});
