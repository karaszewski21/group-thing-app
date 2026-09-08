import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "../auth/AuthContext";
import { RegisterPage } from "../pages/RegisterPage";
import { OnboardingPage } from "../pages/OnboardingPage";

// Group 8 gap fill (implementation-plan.md 8.2(a)): Groups 1-7 each tested
// their own surface in isolation (Group 4: register() posts the right body
// and navigates to /onboarding; Group 7: OnboardingWizard picks the right
// Step[] and Skip/X exit identically) but nothing exercised the actual
// register -> /onboarding -> /panel handoff as one flow using the REAL
// AuthProvider (not a mocked useAuth), so this file deliberately does not
// mock "../auth/AuthContext".

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("../api/people", () => ({
  getMyProfile: vi.fn().mockResolvedValue({
    id: 1,
    party_id: 1,
    account_user_id: 1,
    display_name: "Jan Kowalski",
    email: "jan.kowalski@example.com",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  }),
  getLeadershipsForPerson: vi.fn().mockResolvedValue([]),
}));
vi.mock("../api/families", () => ({
  createLightweightMembers: vi.fn(),
}));
vi.mock("../api/products", () => ({
  resolveProduct: vi.fn(),
}));
vi.mock("../api/inventories", () => ({
  getInventories: vi.fn(),
  createInventory: vi.fn(),
  registerInventoryItem: vi.fn(),
}));
vi.mock("../api/groups", () => ({
  createMyCircle: vi.fn(),
}));
vi.mock("../api/organizations", () => ({
  createMyOrganization: vi.fn().mockResolvedValue({
    id: 1,
    party_id: 2,
    name: "Muzyczne Skrzaty",
    primary_color: null,
    accent_color: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  }),
}));
vi.mock("../api/terms", () => ({
  createTerm: vi.fn(),
  createNeededItem: vi.fn(),
}));

function fakeJwt(sub: string): string {
  const payload = btoa(JSON.stringify({ sub, permissions: [], exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
}

function renderApp(initialRoute = "/register") {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/panel" element={<div>PANEL</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
});

describe("register -> onboarding -> panel handoff (crosses Group 4 / Group 7 boundary)", () => {
  it("GUEST: registering lands on the 3-step wizard, and skipping reaches /panel", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ token: fakeJwt("jan.kowalski"), party_id: 1, role: "GUEST" }),
    });

    renderApp();

    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: "jan.kowalski@example.com" } });
    fireEvent.change(screen.getByLabelText(/hasło/i), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: /załóż konto/i }));

    // Real AuthProvider.register() -> real navigate -> real OnboardingPage
    // reading registeredRole, no extra profile fetch needed for the GUEST
    // branch.
    expect(await screen.findByLabelText("Krok 1 z 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pomiń" }));

    expect(await screen.findByText("PANEL")).toBeInTheDocument();
  });

  it("ORGANIZER: registering lands on the 3-step wizard with a mandatory organization-name step, then 'X' reaches /panel", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ token: fakeJwt("organizer.jan"), party_id: 2, role: "ORGANIZER" }),
    });

    renderApp();

    fireEvent.click(screen.getByRole("button", { name: /organizator/i }));
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: "organizer@example.com" } });
    fireEvent.change(screen.getByLabelText(/hasło/i), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: /załóż konto/i }));

    expect(await screen.findByLabelText("Krok 1 z 3")).toBeInTheDocument();
    // Step 1 (organization name) is mandatory — no way to skip it.
    expect(screen.queryByRole("button", { name: "Pomiń" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zamknij" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nazwa organizacji"), {
      target: { value: "Muzyczne Skrzaty" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Dalej →" }));

    // Step 2 (circle name) is skippable again — "X" is back.
    expect(await screen.findByLabelText("Krok 2 z 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zamknij" }));

    expect(await screen.findByText("PANEL")).toBeInTheDocument();
  });

  it("duplicate-email registration does not navigate away from /register", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ message: "Ten email jest już zarejestrowany, zaloguj się" }),
    });

    renderApp();

    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: "dup@example.com" } });
    fireEvent.change(screen.getByLabelText(/hasło/i), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: /załóż konto/i }));

    await waitFor(() => {
      expect(screen.getByText(/Ten email jest już zarejestrowany, zaloguj się/i)).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/Krok \d z \d/)).not.toBeInTheDocument();
  });
});
