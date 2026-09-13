import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme";
import type { Category } from "../api/categories";
import * as categoriesApi from "../api/categories";

vi.mock("../auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/AuthContext")>();
  return {
    ...actual,
    useAuth: vi.fn(),
  };
});

vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
  deleteCategory: vi.fn(),
  moveCategory: vi.fn(),
}));

import { useAuth } from "../auth/AuthContext";

const mockCategories: Category[] = [
  {
    id: 1,
    name: "Zabawka",
    description: null,
    sortOrder: 0,
    productCount: 12,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: 2,
    name: "Książka",
    description: null,
    sortOrder: 1,
    productCount: 4,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ChakraProvider value={system}>
      <MemoryRouter initialEntries={["/categories"]}>{ui}</MemoryRouter>
    </ChakraProvider>,
  );
}

function mockAuth(permissions: string[]) {
  vi.mocked(useAuth).mockReturnValue({
    token: "test-token",
    username: "admin",
    displayName: "Admin User",
    permissions,
    registeredRole: null,
    login: vi.fn(),
    register: vi.fn(),
    applyExternalToken: vi.fn(),
    logout: vi.fn(),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("CategoryListPage", () => {
  it("renders the table with NAME / PRODUCTS IN USE / ACTIONS columns from useCategories() data", async () => {
    mockAuth(["ADMIN"]);
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
    const { CategoryListPage } = await import("../pages/CategoryListPage");

    renderWithProviders(<CategoryListPage />);

    expect(await screen.findByText("Zabawka")).toBeInTheDocument();
    expect(screen.getByText("Książka")).toBeInTheDocument();
    expect(screen.getByText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByText(/products in use/i)).toBeInTheDocument();
    expect(screen.getByText(/^actions$/i)).toBeInTheDocument();
  });

  it("gates + Add Category and per-row Edit/Delete on permissions.includes(\"ADMIN\")", async () => {
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
    const { CategoryListPage } = await import("../pages/CategoryListPage");

    mockAuth([]);
    const nonAdmin = renderWithProviders(<CategoryListPage />);
    await nonAdmin.findByText("Zabawka");
    expect(nonAdmin.queryByText("+ Add Category")).not.toBeInTheDocument();
    expect(nonAdmin.queryByRole("link", { name: /edit zabawka/i })).not.toBeInTheDocument();
    expect(nonAdmin.queryByRole("button", { name: /delete zabawka/i })).not.toBeInTheDocument();
    nonAdmin.unmount();

    mockAuth(["ADMIN"]);
    const admin = renderWithProviders(<CategoryListPage />);
    expect(await admin.findByText("+ Add Category")).toBeInTheDocument();
    expect(admin.getByRole("link", { name: /edit zabawka/i })).toBeInTheDocument();
    expect(admin.getByRole("button", { name: /delete zabawka/i })).toBeInTheDocument();
  });

  it("renders EmptyState with an action gated on isAdmin when useCategories() returns zero rows", async () => {
    vi.mocked(categoriesApi.getCategories).mockResolvedValue([]);
    const { CategoryListPage } = await import("../pages/CategoryListPage");

    mockAuth([]);
    const nonAdmin = renderWithProviders(<CategoryListPage />);
    await waitFor(() => expect(categoriesApi.getCategories).toHaveBeenCalled());
    expect(await nonAdmin.findByText("No categories found")).toBeInTheDocument();
    expect(nonAdmin.getByText("Create your first category to get started.")).toBeInTheDocument();
    expect(nonAdmin.queryByText("+ Add Category")).not.toBeInTheDocument();
    nonAdmin.unmount();

    mockAuth(["ADMIN"]);
    const admin = renderWithProviders(<CategoryListPage />);
    expect(await admin.findByText("No categories found")).toBeInTheDocument();
    // Both the header's top-right button and the EmptyState's own action
    // render "+ Add Category" for an admin — see ui-mockups.md Mockup 3.
    expect(admin.getAllByText("+ Add Category").length).toBe(2);
  });
});
