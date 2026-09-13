import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme";
import type { Category } from "../api/categories";
import * as categoriesApi from "../api/categories";

vi.mock("../api/categories", () => ({
  getCategory: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
}));

const mockCategory: Category = {
  id: 1,
  name: "Zabawka",
  description: "Toys",
  sortOrder: 0,
  productCount: 12,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function renderWithProviders(ui: React.ReactElement, initialRoute: string) {
  return render(
    <ChakraProvider value={system}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/categories" element={<div>Categories List</div>} />
          <Route path="/categories/new" element={ui} />
          <Route path="/categories/:id/edit" element={ui} />
        </Routes>
      </MemoryRouter>
    </ChakraProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("CategoryFormPage", () => {
  it("renders single-column name (required) / description (optional) fields and creates via createCategory when adding", async () => {
    vi.mocked(categoriesApi.createCategory).mockResolvedValue(mockCategory);
    const { CategoryFormPage } = await import("../pages/CategoryFormPage");

    renderWithProviders(<CategoryFormPage />, "/categories/new");

    const nameInput = await screen.findByLabelText(/^name/i);
    expect(nameInput).toBeRequired();
    const descriptionInput = screen.getByLabelText(/description/i);
    expect(descriptionInput).not.toBeRequired();
    expect(descriptionInput.tagName).toBe("TEXTAREA");

    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "Gra" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save category/i }));
    });

    await waitFor(() =>
      expect(categoriesApi.createCategory).toHaveBeenCalledWith({
        name: "Gra",
        description: undefined,
      }),
    );
    expect(categoriesApi.updateCategory).not.toHaveBeenCalled();
  });

  it("loads existing category data and submits via updateCategory when editing", async () => {
    vi.mocked(categoriesApi.getCategory).mockResolvedValue(mockCategory);
    vi.mocked(categoriesApi.updateCategory).mockResolvedValue(mockCategory);
    const { CategoryFormPage } = await import("../pages/CategoryFormPage");

    renderWithProviders(<CategoryFormPage />, "/categories/1/edit");

    await screen.findByDisplayValue("Zabawka");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save category/i }));
    });

    await waitFor(() =>
      expect(categoriesApi.updateCategory).toHaveBeenCalledWith(1, {
        name: "Zabawka",
        description: "Toys",
      }),
    );
    expect(categoriesApi.createCategory).not.toHaveBeenCalled();
    // Successful submit navigates back to the list.
    expect(await screen.findByText("Categories List")).toBeInTheDocument();
  });

  it("blocks submission via native required-field validation when name is left empty", async () => {
    const { CategoryFormPage } = await import("../pages/CategoryFormPage");

    renderWithProviders(<CategoryFormPage />, "/categories/new");

    const nameInput = await screen.findByLabelText(/^name/i);
    expect(nameInput).toHaveValue("");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save category/i }));
    });

    expect(categoriesApi.createCategory).not.toHaveBeenCalled();
    expect(categoriesApi.updateCategory).not.toHaveBeenCalled();
  });
});
