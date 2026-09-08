import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import * as groupsApi from "../api/groups";
import { ApiError } from "../api/client";
import { KragGrupyPage } from "../pages/krag/KragGrupyPage";

vi.mock("../api/groups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/groups")>();
  return {
    ...actual,
    getPublicCircle: vi.fn(),
    createRsvp: vi.fn(),
    mergeAnonymousProfile: vi.fn(),
  };
});

const mockApplyExternalToken = vi.fn();
const mockNavigate = vi.fn();

// NOTE: an earlier draft of this mock eagerly called the real `useAuth()`
// here to capture its `applyExternalToken` implementation for reuse in one
// test. That throws ("useAuth must be used within an AuthProvider") because
// this file's component tree is never wrapped in a real `AuthProvider` — so
// the mock stays a plain fixed stub. The real-`applyExternalToken`-then-
// `getMyProfile()` handoff is covered separately, against the real
// `AuthContext`, in `AccountMergeAuthHandoff.test.tsx`.
vi.mock("../auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/AuthContext")>();
  return {
    ...actual,
    useAuth: vi.fn(() => ({
      token: null,
      username: null,
      displayName: null,
      permissions: [],
      registeredRole: null,
      login: vi.fn(),
      register: vi.fn(),
      applyExternalToken: mockApplyExternalToken,
      logout: vi.fn(),
    })),
  };
});

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const GUEST_KEY = groupsApi.guestProfileIdKey(7, 101);

const circleWithTerm: groupsApi.PublicCircleResponse = {
  id: 7,
  name: "Nutki dla starszaków",
  organizer_display_name: "Ania Kowalska",
  next_term: {
    id: 101,
    occurs_on: "2026-03-12",
    description: "Zajęcia rytmiczne",
    needed_items: [{ id: 501, category: "INSTRUMENT", description: "Bębenek" }],
  },
  guardians: [{ display_name: "Marek W." }],
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/krag/:groupId/publiczny" element={<KragGrupyPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
});

describe("PublicKragGrupyPage", () => {
  it("loads without auth and renders circle, term, needed items and guardians", async () => {
    vi.mocked(groupsApi.getPublicCircle).mockResolvedValue(circleWithTerm);

    renderAt("/krag/7/publiczny");

    expect(await screen.findByText("Nutki dla starszaków")).toBeInTheDocument();
    expect(screen.getAllByText(/Ania Kowalska/).length).toBeGreaterThan(0);
    expect(screen.getByText(/2026-03-12/)).toBeInTheDocument();
    expect(screen.getByText(/Bębenek/)).toBeInTheDocument();
    expect(screen.getByText("Marek W.")).toBeInTheDocument();
    expect(groupsApi.getPublicCircle).toHaveBeenCalledWith(7);
    // No auth header attached — nothing in this flow reads/needs auth_token.
    expect(localStorage.getItem("auth_token")).toBeNull();
  });

  it("completes the RSVP flow: dialog submit shows confirmation state", async () => {
    vi.mocked(groupsApi.getPublicCircle).mockResolvedValue(circleWithTerm);
    vi.mocked(groupsApi.createRsvp).mockResolvedValue({
      id: 1,
      term_id: 101,
      user_profile_id: 55,
      guardian_name: "Kasia N.",
      child_count: 2,
    });

    renderAt("/krag/7/publiczny");

    const rsvpButton = await screen.findByRole("button", { name: /Zapisz się na zajęcia/ });
    fireEvent.click(rsvpButton);

    const nameInput = await screen.findByLabelText("Imię");
    fireEvent.change(nameInput, { target: { value: "Kasia N." } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz się" }));

    expect(await screen.findByText("✓ Zapisano! Do zobaczenia na zajęciach.")).toBeInTheDocument();
    expect(localStorage.getItem(GUEST_KEY)).toBe("55");
  });

  it("shows confirmation state on reload when guest_profile_id is already stored", async () => {
    localStorage.setItem(GUEST_KEY, "55");
    vi.mocked(groupsApi.getPublicCircle).mockResolvedValue(circleWithTerm);

    renderAt("/krag/7/publiczny");

    expect(await screen.findByText("✓ Zapisano! Do zobaczenia na zajęciach.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Zapisz się na zajęcia/ })).not.toBeInTheDocument();
  });

  it("an RSVP stored for a DIFFERENT circle/term does not falsely show the confirmation state here", async () => {
    // Regression test for a completeness-checker finding: guest_profile_id
    // was previously a flat, unscoped key — a visitor who RSVP'd on one
    // Circle's public page would incorrectly see "already RSVP'd" on an
    // unrelated Circle's page. Simulates that prior RSVP (different
    // group/term) and asserts THIS page still shows the "+" CTA.
    localStorage.setItem(groupsApi.guestProfileIdKey(99, 999), "12");
    vi.mocked(groupsApi.getPublicCircle).mockResolvedValue(circleWithTerm);

    renderAt("/krag/7/publiczny");

    expect(await screen.findByRole("button", { name: /Zapisz się na zajęcia/ })).toBeInTheDocument();
    expect(screen.queryByText("✓ Zapisano! Do zobaczenia na zajęciach.")).not.toBeInTheDocument();
  });

  it("never renders any child-identifying field", async () => {
    localStorage.setItem(GUEST_KEY, "55");
    vi.mocked(groupsApi.getPublicCircle).mockResolvedValue(circleWithTerm);

    renderAt("/krag/7/publiczny");

    await waitFor(() => expect(groupsApi.getPublicCircle).toHaveBeenCalled());
    expect(screen.queryByText(/dziecko/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/wiek/i)).not.toBeInTheDocument();
  });

  describe("account-merge trigger (Core Requirement 7 / Group 10)", () => {
    it("clicking 'Zgłoś się' for a visitor with a stored guest_profile_id renders AccountMergeForm inline in place of that row's action", async () => {
      localStorage.setItem(GUEST_KEY, "55");
      vi.mocked(groupsApi.getPublicCircle).mockResolvedValue(circleWithTerm);

      renderAt("/krag/7/publiczny");

      const trigger = await screen.findByRole("button", { name: /Zgłoś się: INSTRUMENT/ });
      fireEvent.click(trigger);

      expect(screen.queryByRole("button", { name: /Zgłoś się: INSTRUMENT/ })).not.toBeInTheDocument();
      expect(screen.getByLabelText("Email")).toBeInTheDocument();
      expect(screen.getByLabelText("Hasło")).toBeInTheDocument();
    });

    it("successful submit stores the token via applyExternalToken and navigates to /panel", async () => {
      localStorage.setItem(GUEST_KEY, "55");
      vi.mocked(groupsApi.getPublicCircle).mockResolvedValue(circleWithTerm);
      vi.mocked(groupsApi.mergeAnonymousProfile).mockResolvedValue({ token: "jwt-token", party_id: 9 });

      renderAt("/krag/7/publiczny");

      fireEvent.click(await screen.findByRole("button", { name: /Zgłoś się: INSTRUMENT/ }));
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ania@example.com" } });
      fireEvent.change(screen.getByLabelText("Hasło"), { target: { value: "sekret123" } });
      fireEvent.click(screen.getByRole("button", { name: "Załóż konto" }));

      await waitFor(() =>
        expect(groupsApi.mergeAnonymousProfile).toHaveBeenCalledWith({
          user_profile_id: 55,
          email: "ania@example.com",
          password: "sekret123",
        }),
      );
      await waitFor(() => expect(mockApplyExternalToken).toHaveBeenCalledWith("jwt-token"));
      expect(mockNavigate).toHaveBeenCalledWith("/panel");
    });

    it("a 409 duplicate-email/already-merged response shows an inline error and keeps guest_profile_id stored", async () => {
      localStorage.setItem(GUEST_KEY, "55");
      vi.mocked(groupsApi.getPublicCircle).mockResolvedValue(circleWithTerm);
      vi.mocked(groupsApi.mergeAnonymousProfile).mockRejectedValue(
        new ApiError(409, "Conflict", { message: "Ten email jest już zarejestrowany, zaloguj się" }),
      );

      renderAt("/krag/7/publiczny");

      fireEvent.click(await screen.findByRole("button", { name: /Zgłoś się: INSTRUMENT/ }));
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ania@example.com" } });
      fireEvent.change(screen.getByLabelText("Hasło"), { target: { value: "sekret123" } });
      fireEvent.click(screen.getByRole("button", { name: "Załóż konto" }));

      expect(await screen.findByText("Ten email jest już zarejestrowany, zaloguj się")).toBeInTheDocument();
      expect(mockApplyExternalToken).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalledWith("/panel");
      expect(localStorage.getItem(GUEST_KEY)).toBe("55");
    });
  });
});
