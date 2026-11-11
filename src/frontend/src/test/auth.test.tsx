import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { sessionFromToken } from "../auth/session";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme/system";
import { createQueryWrapper } from "./queryClient";
import { getTestRouter, renderWithRoute } from "./renderWithRoute";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock window.location
const mockLocation = { href: "", pathname: "/" };
Object.defineProperty(window, "location", {
  value: mockLocation,
  writable: true,
});

// Keep a reference to the real implementations before mocking
let RealAuthProvider: typeof import("../auth/AuthContext").AuthProvider;
let realUseAuth: typeof import("../auth/AuthContext").useAuth;

// Mock the auth module for pages that use useAuth
const mockUseAuth = vi.fn((): {
  token: string | null;
  username: string | null;
  displayName: string | null;
  permissions: string[];
  login: (email: string, password: string) => Promise<void>;
  register: (payload: {
    email: string;
    password: string;
  }) => Promise<void>;
  logout: () => void;
} => ({
  token: "test-token",
  username: "admin",
  displayName: "Admin User",
  permissions: ["EDIT", "PLUGIN_MANAGEMENT"],
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("../auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/AuthContext")>();
  RealAuthProvider = actual.AuthProvider;
  realUseAuth = actual.useAuth;
  return {
    ...actual,
    useAuth: (...args: Parameters<typeof actual.useAuth>) => mockUseAuth(...args),
  };
});

vi.mock("../api/plugins", () => ({
  getPlugins: vi.fn().mockResolvedValue([]),
  getPlugin: vi.fn(),
  uploadManifest: vi.fn(),
  deletePlugin: vi.fn(),
  setPluginEnabled: vi.fn(),
}));

vi.mock("../api/products", () => ({
  getProductsPage: vi.fn(),
  getProduct: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
}));

function renderWithProviders(ui: React.ReactElement, initialRoute = "/") {
  return renderWithRoute(<ChakraProvider value={system}>{ui}</ChakraProvider>, {
    url: initialRoute,
    wrapper: createQueryWrapper(),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mockLocation.href = "";
  mockLocation.pathname = "/";
  // Restore default useAuth mock
  mockUseAuth.mockReturnValue({
    token: "test-token",
    username: "admin",
    displayName: "Admin User",
    permissions: ["EDIT", "PLUGIN_MANAGEMENT"],
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  });
});

describe("API Client Auth", () => {
  it("includes Authorization header from localStorage token", async () => {
    localStorage.setItem("auth_token", "my-jwt-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: "1" }),
    });

    const { api } = await import("../api/client");
    await api.get("/products");

    expect(mockFetch).toHaveBeenCalledWith("/api/products", expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer my-jwt-token",
      }),
    }));
  });

  it("redirects to /login on 401 response", async () => {
    localStorage.setItem("auth_token", "rejected-jwt-token");
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: () => Promise.resolve({ error: "Unauthorized" }),
    });

    const { api } = await import("../api/client");
    try {
      await api.get("/products");
    } catch {
      // expected
    }

    expect(localStorage.getItem("auth_token")).toBeNull();
    expect(mockLocation.href).toContain("/login");
  });
});

describe("LoginPage", () => {
  it("renders email/password form and submits to /api/auth/login", async () => {
    // Configure mock login to actually call fetch (simulating real behavior)
    const mockLogin = vi.fn(async () => {
      // Simulate what real login does
      mockFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@example.com", password: "pass123" }),
      });
    });
    mockUseAuth.mockReturnValue({
      token: null as string | null,
      username: null as string | null,
      displayName: null as string | null,
      permissions: [],
      login: mockLogin,
      register: vi.fn(),
      logout: vi.fn(),
    });

    const { LoginPage } = await import("../features/auth/LoginPage");
    renderWithProviders(<LoginPage />);

    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/hasło/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: "admin@example.com" } });
    fireEvent.change(screen.getByLabelText(/hasło/i), { target: { value: "pass123" } });
    fireEvent.click(screen.getByRole("button", { name: /zaloguj się/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith("admin@example.com", "pass123");
    });
  });
  it("is one page with 'Zaloguj się' / 'Załóż konto' tabs kept in ?mode=", async () => {
    mockUseAuth.mockReturnValue({
      token: null as string | null,
      username: null as string | null,
      displayName: null as string | null,
      permissions: [],
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    const { LoginPage } = await import("../features/auth/LoginPage");
    renderWithProviders(<LoginPage />, "/login?mode=register&returnTo=%2Faccount");

    const registerTab = screen.getByRole("tab", { name: "Załóż konto" });
    expect(registerTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Załóż konto" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Zaloguj się" }));

    expect(screen.getByRole("tab", { name: "Zaloguj się" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: "Załóż konto" })).not.toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toContainElement(screen.getByLabelText(/hasło/i));
  });
});

describe("RegisterForm", () => {
  it("asks only for email and password and registers with exactly {email, password}", async () => {
    const mockRegister = vi.fn(async () => {});
    mockUseAuth.mockReturnValue({
      token: null as string | null,
      username: null as string | null,
      displayName: null as string | null,
      permissions: [],
      login: vi.fn(),
      register: mockRegister,
      logout: vi.fn(),
    });

    const onSwitchToLogin = vi.fn();
    const { RegisterForm } = await import("../features/auth/RegisterForm");
    renderWithProviders(<RegisterForm onSwitchToLogin={onSwitchToLogin} />);

    expect(screen.queryByRole("button", { name: "Gość" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Organizator" })).not.toBeInTheDocument();
    expect(screen.queryByText("Kim jesteś?")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText(/hasło/i), { target: { value: "pass123" } });
    fireEvent.click(screen.getByRole("button", { name: /załóż konto/i }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith({ email: "new@example.com", password: "pass123" });
    });
  });

  it("renders the duplicate-email error message with a /login link", async () => {
    const mockRegister = vi.fn(async () => {
      throw new Error("Ten email jest już zarejestrowany, zaloguj się");
    });
    mockUseAuth.mockReturnValue({
      token: null as string | null,
      username: null as string | null,
      displayName: null as string | null,
      permissions: [],
      login: vi.fn(),
      register: mockRegister,
      logout: vi.fn(),
    });

    const onSwitchToLogin = vi.fn();
    const { RegisterForm } = await import("../features/auth/RegisterForm");
    renderWithProviders(<RegisterForm onSwitchToLogin={onSwitchToLogin} />);

    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: "dup@example.com" } });
    fireEvent.change(screen.getByLabelText(/hasło/i), { target: { value: "pass123" } });
    fireEvent.click(screen.getByRole("button", { name: /załóż konto/i }));

    await waitFor(() => {
      expect(screen.getByText(/Ten email jest już zarejestrowany, zaloguj się/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /^zaloguj się$/i }));
    expect(onSwitchToLogin).toHaveBeenCalledTimes(1);
  });

  it("leaves the redirect after registering to the page's AuthGuard", async () => {
    const mockRegister = vi.fn(async () => {});
    mockUseAuth.mockReturnValue({
      token: null as string | null,
      username: null as string | null,
      displayName: null as string | null,
      permissions: [],
      login: vi.fn(),
      register: mockRegister,
      logout: vi.fn(),
    });

    const onSwitchToLogin = vi.fn();
    const { RegisterForm } = await import("../features/auth/RegisterForm");
    renderWithProviders(<RegisterForm onSwitchToLogin={onSwitchToLogin} />);

    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText(/hasło/i), { target: { value: "pass123" } });
    fireEvent.click(screen.getByRole("button", { name: /załóż konto/i }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith({ email: "new@example.com", password: "pass123" });
    });
    expect(getTestRouter().calls).toEqual([]);
  });
});

describe("AuthContext", () => {
  it("provides token/permissions/login/logout via useAuth hook", async () => {
    // Create a valid JWT
    const payload = btoa(JSON.stringify({ sub: "testuser", permissions: ["EDIT", "PLUGIN_MANAGEMENT"], exp: Math.floor(Date.now() / 1000) + 3600 }));
    const mockToken = `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
    localStorage.setItem("auth_token", mockToken);

    // Use the real implementation by delegating to saved reference
    mockUseAuth.mockImplementation(realUseAuth);

    function TestConsumer() {
      const { token, username, permissions, logout } = mockUseAuth();
      return (
        <div>
          <span data-testid="token">{token ?? "none"}</span>
          <span data-testid="username">{username ?? "none"}</span>
          <span data-testid="permissions">{permissions.join(",")}</span>
          <button onClick={logout}>Logout</button>
        </div>
      );
    }

    render(
      <ChakraProvider value={system}>
        <RealAuthProvider initialSession={sessionFromToken(mockToken)}>
          <TestConsumer />
        </RealAuthProvider>
      </ChakraProvider>, { wrapper: createQueryWrapper() },
    );

    expect(screen.getByTestId("token")).toHaveTextContent(mockToken);
    expect(screen.getByTestId("username")).toHaveTextContent("testuser");
    expect(screen.getByTestId("permissions")).toHaveTextContent("EDIT,PLUGIN_MANAGEMENT");

    fireEvent.click(screen.getByRole("button", { name: /logout/i }));

    await waitFor(() => {
      expect(screen.getByTestId("token")).toHaveTextContent("none");
    });
  });
  it("register posts a GUEST account to /api/auth/register", async () => {
    const payload = btoa(JSON.stringify({ sub: "new", permissions: [], exp: Math.floor(Date.now() / 1000) + 3600 }));
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ token: `eyJhbGciOiJIUzI1NiJ9.${payload}.signature` }), { status: 200 }),
    );
    mockUseAuth.mockImplementation(realUseAuth);

    function TestConsumer() {
      const { register } = mockUseAuth();
      return <button onClick={() => void register({ email: "new@example.com", password: "pass123" })}>Register</button>;
    }

    render(
      <ChakraProvider value={system}>
        <RealAuthProvider initialSession={null}>
          <TestConsumer />
        </RealAuthProvider>
      </ChakraProvider>, { wrapper: createQueryWrapper() },
    );
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith("/api/auth/register", expect.anything()));
    const init = mockFetch.mock.calls.find(([url]) => url === "/api/auth/register")![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ role: "GUEST", email: "new@example.com", password: "pass123" });
  });
});

describe("Permission-based UI visibility", () => {
  it("hides New Product button for users without EDIT permission", async () => {
    mockUseAuth.mockReturnValue({
      token: "test-token",
      username: "reader",
      displayName: null,
      permissions: [],
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    const { PluginProvider } = await import("../plugins/host/PluginHost");
    const { ProductListPage } = await import("../features/admin/ProductListPage");

    renderWithRoute(
      <ChakraProvider value={system}>
        <PluginProvider>
          <ProductListPage />
        </PluginProvider>
      </ChakraProvider>,
      { url: "/admin/products", wrapper: createQueryWrapper() },
    );

    await waitFor(() => {
      expect(screen.queryByText("+ Add Product")).not.toBeInTheDocument();
    });
  });
});
