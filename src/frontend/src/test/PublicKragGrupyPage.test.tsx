import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import * as groupsApi from "../api/groups";
import * as familiesApi from "../api/families";
import { ApiError } from "../api/client";
import { PublicKragGrupyView } from "../pages/krag/KragGrupyPage";
import { PublicKragRedirectPage } from "../pages/krag/PublicKragRedirectPage";

vi.mock("../api/groups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/groups")>();
  return {
    ...actual,
    getPublicCircle: vi.fn(),
    createRsvp: vi.fn(),
    mergeAnonymousProfile: vi.fn(),
  };
});

vi.mock("../api/families", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/families")>();
  return {
    ...actual,
    getMyFamilies: vi.fn(),
  };
});

const mockApplyExternalToken = vi.fn();
const mockNavigate = vi.fn();

// Mutable auth stub — the real `AuthProvider` is never mounted in this file
// (it would throw for a token-less visitor and pull in `getMyProfile`), so
// `useAuth` is a plain arrow returning this object. `beforeEach` resets it to
// the anonymous default; individual tests set a token + displayName. It is
// NOT a `vi.fn()`, so `vi.resetAllMocks()` leaves the implementation intact.
let mockAuthValue: { token: string | null; displayName: string | null };

vi.mock("../auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/AuthContext")>();
  return {
    ...actual,
    useAuth: () => ({
      token: mockAuthValue.token,
      username: null,
      displayName: mockAuthValue.displayName,
      permissions: [],
      registeredRole: null,
      login: vi.fn(),
      register: vi.fn(),
      applyExternalToken: mockApplyExternalToken,
      logout: vi.fn(),
    }),
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
const CANONICAL_PATH = "/ania-kowalska/grupa/7/term/101";

const circleWithTerm: groupsApi.PublicCircleResponse = {
  id: 7,
  name: "Nutki dla starszaków",
  organizer_display_name: "Ania Kowalska",
  organizer_slug: "ania-kowalska",
  next_term: {
    id: 101,
    occurs_on: "2026-03-12",
    description: "Zajęcia rytmiczne",
    needed_items: [{ id: 501, category: "INSTRUMENT", description: "Bębenek" }],
  },
  guardians: [{ display_name: "Marek W." }],
};

function familyOut(overrides: Partial<familiesApi.FamilyOut> = {}): familiesApi.FamilyOut {
  return {
    id: 1,
    party_id: 1,
    name: "Dom Testowy",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    child_count: 0,
    ...overrides,
  };
}

// Mount the real slug routes so the component reads `:groupId` / `:termId`
// (and the resolver reads `:organizationSlug`) straight from the URL.
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/:organizationSlug/grupa/:groupId/term/:termId"
          element={<PublicKragGrupyView />}
        />
        <Route path="/:organizationSlug/grupa/:groupId" element={<PublicKragRedirectPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mockAuthValue = { token: null, displayName: null };
  vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([]);
});

describe("PublicKragGrupyPage", () => {
  it("renders the URL-named term with circle, needed items and guardians", async () => {
    vi.mocked(groupsApi.getPublicCircle).mockResolvedValue(circleWithTerm);

    renderAt(CANONICAL_PATH);

    expect(await screen.findByText("Nutki dla starszaków")).toBeInTheDocument();
    expect(groupsApi.getPublicCircle).toHaveBeenCalledWith(7, 101);
    expect(screen.getAllByText(/Ania Kowalska/).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Termin" })).toBeInTheDocument();
    expect(screen.getByText(/2026-03-12/)).toBeInTheDocument();
    expect(screen.getByText(/Bębenek/)).toBeInTheDocument();
    expect(screen.getByText("Marek W.")).toBeInTheDocument();
  });

  it("loads with no auth token and never bounces to /login", async () => {
    vi.mocked(groupsApi.getPublicCircle).mockResolvedValue(circleWithTerm);

    renderAt(CANONICAL_PATH);

    expect(await screen.findByText("Nutki dla starszaków")).toBeInTheDocument();
    expect(localStorage.getItem("auth_token")).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("completes the anonymous RSVP flow: dialog submit shows the confirmation state", async () => {
    vi.mocked(groupsApi.getPublicCircle).mockResolvedValue(circleWithTerm);
    vi.mocked(groupsApi.createRsvp).mockResolvedValue({
      id: 1,
      term_id: 101,
      user_profile_id: 55,
      guardian_name: "Kasia N.",
      child_count: 2,
      attached_to_account: false,
    });

    renderAt(CANONICAL_PATH);

    fireEvent.click(await screen.findByRole("button", { name: /Zapisz się na zajęcia/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Zapisz się jako gość" }));

    fireEvent.change(await screen.findByLabelText("Imię"), { target: { value: "Kasia N." } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz się" }));

    expect(await screen.findByText(/✓ Zapisano!/)).toBeInTheDocument();
    expect(localStorage.getItem(GUEST_KEY)).toBe("55");
  });

  it("anonymous 'Zapisz się na zajęcia' first shows a login/register-or-guest choice", async () => {
    vi.mocked(groupsApi.getPublicCircle).mockResolvedValue(circleWithTerm);

    renderAt(CANONICAL_PATH);

    fireEvent.click(await screen.findByRole("button", { name: /Zapisz się na zajęcia/ }));

    // the choice gate, not the guest form yet
    expect(await screen.findByRole("link", { name: "Zaloguj się" })).toHaveAttribute(
      "href",
      `/login?returnTo=${encodeURIComponent(CANONICAL_PATH)}`,
    );
    expect(screen.getByRole("link", { name: "Zarejestruj się" })).toHaveAttribute("href", "/register");
    expect(screen.queryByLabelText("Imię")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zapisz się jako gość" }));
    expect(await screen.findByLabelText("Imię")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows the confirmation state on reload when the scoped key is already stored", async () => {
    localStorage.setItem(GUEST_KEY, "55");
    vi.mocked(groupsApi.getPublicCircle).mockResolvedValue(circleWithTerm);

    renderAt(CANONICAL_PATH);

    expect(await screen.findByText(/✓ Zapisano!/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Zapisz się na zajęcia/ }),
    ).not.toBeInTheDocument();
  });

  it("an RSVP stored for a DIFFERENT circle/term does not falsely show the confirmation here", async () => {
    localStorage.setItem(groupsApi.guestProfileIdKey(99, 999), "12");
    vi.mocked(groupsApi.getPublicCircle).mockResolvedValue(circleWithTerm);

    renderAt(CANONICAL_PATH);

    expect(
      await screen.findByRole("button", { name: /Zapisz się na zajęcia/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/✓ Zapisano!/)).not.toBeInTheDocument();
  });

  it("shows 'Nie znaleziono' for a mismatched / nonexistent term and does not redirect", async () => {
    vi.mocked(groupsApi.getPublicCircle).mockRejectedValue(
      new ApiError(404, "Not Found", { message: "Nie znaleziono terminu" }),
    );

    renderAt(CANONICAL_PATH);

    expect(await screen.findByText("Nie znaleziono")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("never renders any child-identifying field", async () => {
    localStorage.setItem(GUEST_KEY, "55");
    vi.mocked(groupsApi.getPublicCircle).mockResolvedValue(circleWithTerm);

    renderAt(CANONICAL_PATH);

    await waitFor(() => expect(groupsApi.getPublicCircle).toHaveBeenCalled());
    expect(screen.queryByText(/dziecko/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/wiek/i)).not.toBeInTheDocument();
  });

  describe("logged-in RSVP variant (R7)", () => {
    beforeEach(() => {
      mockAuthValue = { token: "valid.jwt.token", displayName: "Ala Testowa" };
      vi.mocked(groupsApi.getPublicCircle).mockResolvedValue(circleWithTerm);
    });

    it("logged-in user RSVP attaches and writes no guest_profile_id key", async () => {
      vi.mocked(groupsApi.createRsvp).mockResolvedValue({
        id: 9,
        term_id: 101,
        user_profile_id: 42,
        guardian_name: "Ala Testowa",
        child_count: 0,
        attached_to_account: true,
      });

      renderAt(CANONICAL_PATH);

      fireEvent.click(await screen.findByRole("button", { name: /Zapisz się na zajęcia/ }));
      fireEvent.click(await screen.findByRole("button", { name: "Zapisz się" }));

      await waitFor(() =>
        expect(groupsApi.createRsvp).toHaveBeenCalledWith(7, {
          term_id: 101,
          guardian_name: "Ala Testowa",
          child_count: 0,
        }),
      );
      expect(await screen.findByText(/✓ Zapisano!/)).toBeInTheDocument();
      expect(localStorage.getItem(GUEST_KEY)).toBeNull();
      // no guest_profile_id:* key at all
      expect(
        Object.keys(localStorage).some((k) => k.startsWith("guest_profile_id:")),
      ).toBe(false);
    });

    it("logged-in dialog shows no name field and confirms display_name", async () => {
      vi.mocked(groupsApi.createRsvp).mockResolvedValue({
        id: 9,
        term_id: 101,
        user_profile_id: 42,
        guardian_name: "Ala Testowa",
        child_count: 0,
        attached_to_account: true,
      });

      renderAt(CANONICAL_PATH);

      fireEvent.click(await screen.findByRole("button", { name: /Zapisz się na zajęcia/ }));

      expect(await screen.findByText(/Zapisujesz się jako/)).toBeInTheDocument();
      expect(screen.queryByLabelText("Imię")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Zapisz się" }));

      expect(await screen.findByText(/✓ Zapisano!/)).toBeInTheDocument();
      expect(screen.getByText(/Ala Testowa/)).toBeInTheDocument();
    });

    it("shows a 'Mój panel' link in the header for a logged-in visitor", async () => {
      renderAt(CANONICAL_PATH);

      expect(await screen.findByRole("link", { name: /Mój panel/ })).toHaveAttribute("href", "/panel");
    });

    it("child count prefilled from family CHILD count; editable", async () => {
      vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([familyOut({ child_count: 2 })]);

      renderAt(CANONICAL_PATH);

      fireEvent.click(await screen.findByRole("button", { name: /Zapisz się na zajęcia/ }));

      const field = await screen.findByLabelText("Liczba dzieci");
      expect(field).toHaveValue(2);

      fireEvent.change(field, { target: { value: "3" } });
      expect(field).toHaveValue(3);
    });

    it("no family shows banner; Pomiń reveals numeric field; banner links toward family creation", async () => {
      vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([]);

      renderAt(CANONICAL_PATH);

      fireEvent.click(await screen.findByRole("button", { name: /Zapisz się na zajęcia/ }));

      expect(
        await screen.findByText("Dodaj rodzinę, aby uzupełnić liczbę dzieci"),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Mój dom/ })).toHaveAttribute("href", "/panel");
      expect(screen.queryByLabelText("Liczba dzieci")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Pomiń" }));

      expect(await screen.findByLabelText("Liczba dzieci")).toBeInTheDocument();
    });

    it("attached_to_account true renders no account suggestion", async () => {
      vi.mocked(groupsApi.createRsvp).mockResolvedValue({
        id: 9,
        term_id: 101,
        user_profile_id: 42,
        guardian_name: "Ala Testowa",
        child_count: 0,
        attached_to_account: true,
      });

      renderAt(CANONICAL_PATH);

      fireEvent.click(await screen.findByRole("button", { name: /Zapisz się na zajęcia/ }));
      fireEvent.click(await screen.findByRole("button", { name: "Zapisz się" }));

      expect(await screen.findByText(/✓ Zapisano!/)).toBeInTheDocument();
      expect(screen.queryByText("Załóż konto, aby zachować dostęp")).not.toBeInTheDocument();
    });

    it("reload shows server-derived 'already signed up' when display_name is among the guardians", async () => {
      vi.mocked(groupsApi.getPublicCircle).mockResolvedValue({
        ...circleWithTerm,
        guardians: [{ display_name: "Marek W." }, { display_name: "Ala Testowa" }],
      });

      renderAt(CANONICAL_PATH);

      expect(await screen.findByText(/✓ Zapisano!/)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Zapisz się na zajęcia/ }),
      ).not.toBeInTheDocument();
      expect(
        Object.keys(localStorage).some((k) => k.startsWith("guest_profile_id:")),
      ).toBe(false);
    });

    it("expired/absent token never redirects to /login", async () => {
      mockAuthValue = { token: null, displayName: null };
      vi.mocked(groupsApi.getPublicCircle).mockResolvedValue(circleWithTerm);

      renderAt(CANONICAL_PATH);

      fireEvent.click(await screen.findByRole("button", { name: /Zapisz się na zajęcia/ }));
      // anonymous → the choice gate, then the guest dialog with the "Imię" field
      fireEvent.click(await screen.findByRole("button", { name: "Zapisz się jako gość" }));
      expect(await screen.findByLabelText("Imię")).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalledWith("/login");
    });
  });

  describe("post-anonymous-RSVP account suggestion (R8 / D7)", () => {
    beforeEach(() => {
      vi.mocked(groupsApi.getPublicCircle).mockResolvedValue(circleWithTerm);
      vi.mocked(groupsApi.createRsvp).mockResolvedValue({
        id: 1,
        term_id: 101,
        user_profile_id: 77,
        guardian_name: "Kasia N.",
        child_count: 1,
        attached_to_account: false,
      });
    });

    async function submitAnonymousRsvp() {
      renderAt(CANONICAL_PATH);
      fireEvent.click(await screen.findByRole("button", { name: /Zapisz się na zajęcia/ }));
      fireEvent.click(await screen.findByRole("button", { name: "Zapisz się jako gość" }));
      fireEvent.change(await screen.findByLabelText("Imię"), { target: { value: "Kasia N." } });
      fireEvent.click(screen.getByRole("button", { name: "Zapisz się" }));
      expect(await screen.findByText(/✓ Zapisano!/)).toBeInTheDocument();
    }

    it("anonymous RSVP shows a skippable AccountMergeForm in the confirmation block", async () => {
      await submitAnonymousRsvp();

      expect(screen.getByText("Załóż konto, aby zachować dostęp")).toBeInTheDocument();
      const heading = screen.getByText("Załóż konto, aby zachować dostęp");
      const emailInput = screen.getByLabelText("Email");
      expect(emailInput).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Może później" }));

      expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
      expect(screen.getByText(/✓ Zapisano!/)).toBeInTheDocument();
      expect(heading).not.toBeInTheDocument();
    });

    it("the suggestion form is seeded with the returned user_profile_id", async () => {
      vi.mocked(groupsApi.mergeAnonymousProfile).mockResolvedValue({ token: "jwt", party_id: 3 });

      await submitAnonymousRsvp();

      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "kasia@example.com" } });
      fireEvent.change(screen.getByLabelText("Hasło"), { target: { value: "sekret123" } });
      fireEvent.click(screen.getByRole("button", { name: "Załóż konto" }));

      await waitFor(() =>
        expect(groupsApi.mergeAnonymousProfile).toHaveBeenCalledWith({
          user_profile_id: 77,
          email: "kasia@example.com",
          password: "sekret123",
        }),
      );
    });

    it("duplicate-email merge shows inline 409 without losing the confirmation", async () => {
      vi.mocked(groupsApi.mergeAnonymousProfile).mockRejectedValue(
        new ApiError(409, "Conflict", { message: "Ten email jest już zarejestrowany, zaloguj się" }),
      );

      await submitAnonymousRsvp();

      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "kasia@example.com" } });
      fireEvent.change(screen.getByLabelText("Hasło"), { target: { value: "sekret123" } });
      fireEvent.click(screen.getByRole("button", { name: "Załóż konto" }));

      expect(
        await screen.findByText("Ten email jest już zarejestrowany, zaloguj się"),
      ).toBeInTheDocument();
      expect(screen.getByText(/✓ Zapisano!/)).toBeInTheDocument();
    });
  });

  describe("account-merge trigger (Core Requirement 7 / Group 10)", () => {
    it("clicking 'Zgłoś się' for a visitor with a stored guest_profile_id renders AccountMergeForm inline in place of that row's action", async () => {
      localStorage.setItem(GUEST_KEY, "55");
      vi.mocked(groupsApi.getPublicCircle).mockResolvedValue(circleWithTerm);

      renderAt(CANONICAL_PATH);

      const trigger = await screen.findByRole("button", { name: /Zgłoś się: INSTRUMENT/ });
      fireEvent.click(trigger);

      expect(
        screen.queryByRole("button", { name: /Zgłoś się: INSTRUMENT/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByLabelText("Email")).toBeInTheDocument();
      expect(screen.getByLabelText("Hasło")).toBeInTheDocument();
    });

    it("successful submit stores the token via applyExternalToken and navigates to /panel", async () => {
      localStorage.setItem(GUEST_KEY, "55");
      vi.mocked(groupsApi.getPublicCircle).mockResolvedValue(circleWithTerm);
      vi.mocked(groupsApi.mergeAnonymousProfile).mockResolvedValue({ token: "jwt-token", party_id: 9 });

      renderAt(CANONICAL_PATH);

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

      renderAt(CANONICAL_PATH);

      fireEvent.click(await screen.findByRole("button", { name: /Zgłoś się: INSTRUMENT/ }));
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ania@example.com" } });
      fireEvent.change(screen.getByLabelText("Hasło"), { target: { value: "sekret123" } });
      fireEvent.click(screen.getByRole("button", { name: "Załóż konto" }));

      expect(
        await screen.findByText("Ten email jest już zarejestrowany, zaloguj się"),
      ).toBeInTheDocument();
      expect(mockApplyExternalToken).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalledWith("/panel");
      expect(localStorage.getItem(GUEST_KEY)).toBe("55");
    });
  });

  describe("term-less redirect (PublicKragRedirectPage)", () => {
    it("redirects to the nearest term, echoing the cosmetic slug", async () => {
      vi.mocked(groupsApi.getPublicCircle).mockResolvedValue(circleWithTerm);

      renderAt("/ania-kowalska/grupa/7");

      await waitFor(() =>
        expect(mockNavigate).toHaveBeenCalledWith("/ania-kowalska/grupa/7/term/101", {
          replace: true,
        }),
      );
      expect(groupsApi.getPublicCircle).toHaveBeenCalledWith(7);
    });

    it("renders the 'no terms yet' page in place when the circle has zero terms", async () => {
      vi.mocked(groupsApi.getPublicCircle).mockResolvedValue({
        ...circleWithTerm,
        next_term: null,
      });

      renderAt("/ania-kowalska/grupa/7");

      expect(
        await screen.findByText("Organizator nie dodał jeszcze żadnych zajęć."),
      ).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });
});
