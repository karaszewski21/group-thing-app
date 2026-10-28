import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme";
import type { Category } from "../api/categories";
import * as categoriesApi from "../api/categories";
import { ApiError } from "../api/client";
import { CategoryListPage } from "../pages/admin/CategoryListPage";

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
import { createQueryWrapper } from "./queryClient";

function category(id: string, name: string, parentId: string | null, sortOrder: number, productCount = 0): Category {
  return {
    id,
    name,
    description: null,
    parent_id: parentId,
    sort_order: sortOrder,
    product_count: productCount,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

const mockCategories: Category[] = [
  category("r1", "Kobiety", null, 0),
  category("c1", "Ubrania", "r1", 0),
  category("l1", "Sukienki", "c1", 0),
  category("l2", "Inne ubrania", "c1", 1, 3),
  category("c2", "Buty", "r1", 1),
  category("l3", "Kozaki", "c2", 0),
  category("c3", "Torebki", "r1", 2),
  category("c4", "Biżuteria", "r1", 3),
  category("r2", "Mężczyźni", null, 1),
  ...["Koszule", "Spodnie", "Kurtki", "Swetry", "Garnitury"].map((name, i) => category(`m${i}`, name, "r2", i)),
];

function renderPage() {
  return render(
    <ChakraProvider value={system}>
      <MemoryRouter initialEntries={["/admin/categories"]}>
        <CategoryListPage />
      </MemoryRouter>
    </ChakraProvider>,
    { wrapper: createQueryWrapper() },
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

function rowOf(name: string): HTMLElement {
  return screen.getByTestId(`category-row-${name}`);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth(["ADMIN"]);
  vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
});

describe("CategoryListPage", () => {
  it("renders nested rows with disclosure aria-expanded and Polish plural meta", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Kategorie" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+ Nowa kategoria główna" })).toHaveAttribute(
      "href",
      "/admin/categories/new",
    );
    const kobiety = screen.getByRole("button", { name: "Kobiety" });
    expect(kobiety).toHaveAttribute("aria-expanded", "false");
    expect(within(rowOf("Kobiety")).getByText("4 podkategorie")).toBeInTheDocument();
    expect(within(rowOf("Mężczyźni")).getByText("5 podkategorii")).toBeInTheDocument();
    expect(screen.queryByText("Ubrania")).not.toBeInTheDocument();

    fireEvent.click(kobiety);
    expect(kobiety).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Ubrania" }));

    expect(within(rowOf("Ubrania")).getByText("2 podkategorie")).toBeInTheDocument();
    expect(within(rowOf("Inne ubrania")).getByText("3 rzeczy")).toBeInTheDocument();
    // A leaf has no disclosure button, and the children sit in a nested list.
    expect(screen.queryByRole("button", { name: "Sukienki" })).not.toBeInTheDocument();
    expect(rowOf("Sukienki").closest("ul")?.parentElement?.closest("ul")).not.toBeNull();
    expect(screen.getByRole("link", { name: "+ Podkategoria w Ubrania" })).toHaveAttribute(
      "href",
      "/admin/categories/new?parent=c1",
    );
  });

  it("moves a category within its siblings with the arrow buttons", async () => {
    vi.mocked(categoriesApi.moveCategory).mockResolvedValue(mockCategories[4]!);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Kobiety" }));

    expect(screen.getByRole("button", { name: "Przenieś Ubrania w górę" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Przenieś Biżuteria w dół" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Przenieś Buty w górę" }));

    await waitFor(() => expect(categoriesApi.moveCategory).toHaveBeenCalledWith("c2", "up"));
  });

  it("shows the backend's 409 delete message in the top alert", async () => {
    const message = "Nie można usunąć „Kobiety”: kategoria ma podkategorie.";
    vi.mocked(categoriesApi.deleteCategory).mockRejectedValue(
      new ApiError(409, "Conflict", { type: "about:blank", title: "Conflict", status: 409, detail: message }),
    );
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Usuń Kobiety" }));
    expect(await screen.findByText("Kategoria „Kobiety” zostanie trwale usunięta.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Usuń" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(categoriesApi.deleteCategory).toHaveBeenCalledWith("r1");
    await waitFor(() =>
      expect(screen.queryByText("Kategoria „Kobiety” zostanie trwale usunięta.")).not.toBeInTheDocument(),
    );
  });

  it("disables + Podkategoria and Usuń with a title on a category with products", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Kobiety" }));
    fireEvent.click(screen.getByRole("button", { name: "Ubrania" }));

    const row = within(rowOf("Inne ubrania"));
    const addChild = row.getByRole("button", { name: "+ Podkategoria w Inne ubrania" });
    const remove = row.getByRole("button", { name: "Usuń Inne ubrania" });
    for (const button of [addChild, remove]) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", "Kategoria ma przypisane rzeczy");
    }
    expect(within(rowOf("Sukienki")).getByRole("button", { name: "Usuń Sukienki" })).toBeEnabled();
  });

  it("filters by name and expands the branches that contain matches", async () => {
    renderPage();
    await screen.findByRole("button", { name: "Kobiety" });

    fireEvent.change(screen.getByRole("textbox", { name: "Filtruj po nazwie" }), { target: { value: "kozak" } });

    expect(screen.getByRole("button", { name: "Kobiety" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Buty" })).toHaveAttribute("aria-expanded", "true");
    expect(rowOf("Kozaki")).toBeInTheDocument();
    expect(screen.queryByText("Mężczyźni")).not.toBeInTheDocument();
    expect(screen.queryByText("Ubrania")).not.toBeInTheDocument();
  });

  it("expands the branches of matches that arrive after the filter was typed", async () => {
    const refreshed = [
      ...mockCategories,
      category("m5", "Buty męskie", "r2", 5),
      category("m6", "Kozaki męskie", "m5", 0),
    ];
    vi.mocked(categoriesApi.moveCategory).mockResolvedValue(mockCategories[4]!);
    renderPage();
    await screen.findByRole("button", { name: "Kobiety" });
    fireEvent.change(screen.getByRole("textbox", { name: "Filtruj po nazwie" }), { target: { value: "kozak" } });
    expect(screen.queryByText("Mężczyźni")).not.toBeInTheDocument();

    vi.mocked(categoriesApi.getCategories).mockResolvedValue(refreshed);
    fireEvent.click(screen.getByRole("button", { name: "Przenieś Buty w górę" }));

    expect(await screen.findByTestId("category-row-Kozaki męskie")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mężczyźni" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Buty męskie" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Buty" })).toHaveAttribute("aria-expanded", "true");
  });

  it("hides the admin actions from a non-admin", async () => {
    mockAuth([]);
    renderPage();
    await screen.findByRole("button", { name: "Kobiety" });

    expect(screen.queryByText("+ Nowa kategoria główna")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Usuń Kobiety" })).not.toBeInTheDocument();
  });
});
