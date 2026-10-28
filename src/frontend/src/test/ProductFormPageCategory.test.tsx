import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme";
import * as productsApi from "../api/products";
import * as categoriesApi from "../api/categories";
import type { Category } from "../api/categories";
import { ProductFormPage } from "../pages/admin/ProductFormPage";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";
import { ApiError } from "../api/client";

vi.mock("../api/products", () => ({
  getProduct: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
}));

vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
  deleteCategory: vi.fn(),
  moveCategory: vi.fn(),
}));

function category(id: string, name: string, parentId: string | null, sortOrder: number): Category {
  return {
    id,
    name,
    description: null,
    parent_id: parentId,
    sort_order: sortOrder,
    product_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

const mockCategories: Category[] = [
  category("1", "Dzieci", null, 0),
  category("5", "Zabawki", "1", 0),
  category("7", "Książki", "1", 1),
];

async function chooseCategory(path: string[]) {
  const trigger = await screen.findByRole("button", { name: /^Category/ });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "Wybierz kategorię" });
  for (const name of path) {
    fireEvent.click(await within(dialog).findByRole("button", { name }));
  }
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

function renderForm(client = createTestQueryClient()) {
  return render(
    <ChakraProvider value={system}>
      <MemoryRouter initialEntries={["/admin/products/new"]}>
        <ProductFormPage />
      </MemoryRouter>
    </ChakraProvider>, { wrapper: createQueryWrapper(client) },
  );
}

describe("ProductFormPage — category data source", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
    vi.mocked(productsApi.createProduct).mockResolvedValue({
      id: "1",
      name: "Rowerek",
      description: null,
      photo_url: null,
      sku: "ABC",
      category_id: "5",
      plugin_data: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
  });

  it("picks a leaf with the leaf-mode picker without submitting and posts category_id", async () => {
    renderForm();

    await screen.findByText("Select a category...");
    fireEvent.change(screen.getByLabelText(/product name/i), { target: { value: "Rowerek" } });
    fireEvent.change(screen.getByLabelText(/sku/i), { target: { value: "ABC" } });
    await chooseCategory(["Dzieci", "Książki"]);

    expect(productsApi.createProduct).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Category \* Dzieci › Książki/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save product/i }));

    await waitFor(() => {
      expect(productsApi.createProduct).toHaveBeenCalledWith(
        expect.objectContaining({ category_id: "7" }),
      );
    });
    const payload = vi.mocked(productsApi.createProduct).mock.calls[0]![0];
    expect(payload).not.toHaveProperty("category");
  });

  it("invalidates the cached categories after a successful create, so product_count refreshes", async () => {
    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    renderForm(client);

    await screen.findByText("Select a category...");
    fireEvent.change(screen.getByLabelText(/product name/i), { target: { value: "Rowerek" } });
    fireEvent.change(screen.getByLabelText(/sku/i), { target: { value: "ABC" } });
    await chooseCategory(["Dzieci", "Zabawki"]);
    expect(categoriesApi.getCategories).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /save product/i }));

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["categories"] }));
    await waitFor(() => expect(categoriesApi.getCategories).toHaveBeenCalledTimes(2));
  });

  it("does not submit without a category and marks the picker invalid", async () => {
    renderForm();

    await screen.findByText("Select a category...");
    fireEvent.change(screen.getByLabelText(/product name/i), { target: { value: "Rowerek" } });
    fireEvent.change(screen.getByLabelText(/sku/i), { target: { value: "ABC" } });
    fireEvent.click(screen.getByRole("button", { name: /save product/i }));

    expect(await screen.findByText("Select a category.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Category/ })).toHaveAttribute("aria-invalid", "true");
    expect(productsApi.createProduct).not.toHaveBeenCalled();
  });
});

describe("ProductFormPage — server error message", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
  });

  it("shows the server's 400 moderation message in role=alert and stays on the form", async () => {
    const message = "Nazwa rzeczy narusza zasady społeczności. Zmień ją i spróbuj ponownie.";
    vi.mocked(productsApi.createProduct).mockRejectedValue(
      new ApiError(400, "Bad Request", { status: 400, error: "Bad Request", message }),
    );
    renderForm();

    await screen.findByText("Select a category...");
    fireEvent.change(screen.getByLabelText(/product name/i), { target: { value: "Rowerek" } });
    fireEvent.change(screen.getByLabelText(/sku/i), { target: { value: "ABC" } });
    await chooseCategory(["Dzieci", "Zabawki"]);
    fireEvent.click(screen.getByRole("button", { name: /save product/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText(/product name/i)).toHaveValue("Rowerek");
  });
});

describe("ProductFormPage — picker inside the admin form", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
  });

  it("never submits from Enter in the picker search or the ✕ close button", async () => {
    renderForm();

    await screen.findByText("Select a category...");
    fireEvent.change(screen.getByLabelText(/product name/i), { target: { value: "Rowerek" } });
    fireEvent.change(screen.getByLabelText(/sku/i), { target: { value: "ABC" } });
    await chooseCategory(["Dzieci", "Zabawki"]);

    const trigger = screen.getByRole("button", { name: /^Category \* Dzieci › Zabawki/ });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Wybierz kategorię" });
    const search = within(dialog).getByRole("combobox", { name: "Szukaj kategorii" });
    expect((search as HTMLInputElement).form).toBeNull();

    fireEvent.change(search, { target: { value: "ksiazki" } });
    expect(fireEvent.keyDown(search, { key: "Enter" })).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Zamknij" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(productsApi.createProduct).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Category \* Dzieci › Zabawki/ })).toBeInTheDocument();
  });
});
