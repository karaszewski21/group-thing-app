import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme";
import type { Category } from "../api/categories";
import * as categoriesApi from "../api/categories";
import { ApiError } from "../api/client";
import { CategoryFormPage } from "../pages/admin/CategoryFormPage";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
  getCategory: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
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
  category("r1", "Kobiety", null, 0),
  category("c1", "Ubrania", "r1", 0),
  category("l1", "Sukienki", "c1", 0),
];

function renderAt(initialRoute: string) {
  return render(
    <ChakraProvider value={system}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/admin/categories" element={<div>Lista kategorii</div>} />
          <Route path="/admin/categories/new" element={<CategoryFormPage />} />
          <Route path="/admin/categories/:id/edit" element={<CategoryFormPage />} />
        </Routes>
      </MemoryRouter>
    </ChakraProvider>,
    { wrapper: createQueryWrapper() },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
});

describe("CategoryFormPage", () => {
  it("preselects ?parent= in the any-mode picker and posts parent_id", async () => {
    vi.mocked(categoriesApi.createCategory).mockResolvedValue(category("n1", "Sukienki koktajlowe", "c1", 1));
    renderAt("/admin/categories/new?parent=c1");

    expect(await screen.findByRole("heading", { name: "Nowa podkategoria" })).toBeInTheDocument();
    const trigger = await screen.findByRole("button", { name: /^Kategoria nadrzędna Kobiety › Ubrania/ });
    expect(trigger).toHaveAccessibleDescription("Puste = kategoria główna. Nie można zmienić po utworzeniu.");
    // Field order: parent, name, description.
    const name = screen.getByLabelText("Nazwa");
    const description = screen.getByLabelText("Opis (opcjonalnie)");
    expect(trigger.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(name.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.change(name, { target: { value: "Sukienki koktajlowe" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    });

    await waitFor(() =>
      expect(categoriesApi.createCategory).toHaveBeenCalledWith({
        name: "Sukienki koktajlowe",
        description: undefined,
        parent_id: "c1",
      }),
    );
    expect(await screen.findByText("Lista kategorii")).toBeInTheDocument();
    // The cached tree is refreshed before navigating back to it.
    expect(categoriesApi.getCategories).toHaveBeenCalledTimes(2);
  });

  it("posts parent_id null when the root option is chosen, without submitting from the picker", async () => {
    vi.mocked(categoriesApi.createCategory).mockResolvedValue(category("n2", "Dom", null, 1));
    renderAt("/admin/categories/new?parent=c1");

    const trigger = await screen.findByRole("button", { name: /^Kategoria nadrzędna Kobiety › Ubrania/ });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Wybierz kategorię" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Kategoria główna (brak)" }));
    expect(categoriesApi.createCategory).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Nowa kategoria główna" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: "Dom" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    });

    await waitFor(() =>
      expect(categoriesApi.createCategory).toHaveBeenCalledWith({ name: "Dom", description: undefined, parent_id: null }),
    );
  });

  it("shows the parent path read-only in edit mode and a 409 inline", async () => {
    const message = "Kategoria o tej nazwie już istnieje na tym poziomie";
    vi.mocked(categoriesApi.getCategory).mockResolvedValue({ ...mockCategories[2]!, description: "Midi" });
    vi.mocked(categoriesApi.updateCategory).mockRejectedValue(
      new ApiError(409, "Conflict", { type: "about:blank", title: "Conflict", status: 409, detail: message }),
    );
    renderAt("/admin/categories/l1/edit");

    await screen.findByDisplayValue("Sukienki");
    expect(await screen.findByText("Kobiety › Ubrania")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Kategoria nadrzędna/ })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    });

    expect(categoriesApi.updateCategory).toHaveBeenCalledWith("l1", { name: "Sukienki", description: "Midi" });
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByText("Lista kategorii")).not.toBeInTheDocument();
  });

  it("blocks submission via native required-field validation when the name is empty", async () => {
    renderAt("/admin/categories/new");

    const name = await screen.findByLabelText("Nazwa");
    expect(name).toBeRequired();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    });

    expect(categoriesApi.createCategory).not.toHaveBeenCalled();
  });
});

describe("CategoryFormPage — picker inside the admin form", () => {
  it("never submits from Enter in the picker search or the ✕ close button", async () => {
    renderAt("/admin/categories/new?parent=c1");

    const trigger = await screen.findByRole("button", { name: /^Kategoria nadrzędna Kobiety › Ubrania/ });
    fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: "Sukienki koktajlowe" } });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Wybierz kategorię" });
    const search = within(dialog).getByRole("combobox", { name: "Szukaj kategorii" });
    expect((search as HTMLInputElement).form).toBeNull();

    fireEvent.change(search, { target: { value: "sukienki" } });
    expect(fireEvent.keyDown(search, { key: "Enter" })).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Zamknij" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(categoriesApi.createCategory).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Nowa podkategoria" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Kategoria nadrzędna Kobiety › Ubrania/ })).toBeInTheDocument();
    expect(screen.queryByText("Lista kategorii")).not.toBeInTheDocument();
  });
});
