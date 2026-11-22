import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme/system";
import type { Category, SizeClass } from "../api/categories";
import * as categoriesApi from "../api/categories";
import { ApiError } from "../api/client";
import type { PointsConfig } from "../api/points";
import * as pointsApi from "../api/points";
import { CategoryFormPage } from "../features/admin/CategoryFormPage";
import { createQueryWrapper } from "./queryClient";
import { renderWithRoute } from "./renderWithRoute";

vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
  getCategory: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
}));

vi.mock("../api/points", () => ({
  getPointsConfig: vi.fn(),
}));

const POINTS_CONFIG: PointsConfig = {
  base_small: 20,
  base_medium: 40,
  base_large: 60,
  multiplier_new: 1.5,
  multiplier_like_new: 1.25,
  multiplier_good: 1,
  multiplier_fair: 0.75,
  multiplier_poor: 0.5,
  swap_award: 10,
  wants_bonus: 10,
  attendance_levels: [0, 10, 20],
  attendance_monthly_cap: 40,
  attendance_min_present: 3,
  attendance_auto_close_days: 7,
  pair_reward_limit: 3,
  pair_window_days: 30,
  max_points_offers: 5,
  updated_at: "2026-11-19T10:00:00",
};

function category(
  id: string,
  name: string,
  parentId: string | null,
  sortOrder: number,
  sizeClass: SizeClass | null = null,
): Category {
  return {
    id,
    name,
    description: null,
    parent_id: parentId,
    sort_order: sortOrder,
    product_count: 0,
    size_class: sizeClass,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

const mockCategories: Category[] = [
  category("r1", "Kobiety", null, 0),
  category("c1", "Ubrania", "r1", 0, "LARGE"),
  category("l1", "Sukienki", "c1", 0),
];

function renderAt(initialRoute: string) {
  const QueryWrapper = createQueryWrapper();
  return renderWithRoute(<CategoryFormPage />, {
    url: initialRoute,
    pattern: "/admin/categories/new",
    routes: {
      "/admin/categories": <div>Lista kategorii</div>,
      "/admin/categories/:id/edit": <CategoryFormPage />,
    },
    wrapper: ({ children }) => (
      <QueryWrapper>
        <ChakraProvider value={system}>{children}</ChakraProvider>
      </QueryWrapper>
    ),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
  vi.mocked(pointsApi.getPointsConfig).mockResolvedValue(POINTS_CONFIG);
});

describe("CategoryFormPage", () => {
  it("preselects ?parent= in the any-mode picker and posts parent_id", async () => {
    vi.mocked(categoriesApi.createCategory).mockResolvedValue(category("n1", "Sukienki koktajlowe", "c1", 1));
    renderAt("/admin/categories/new?parent=c1");

    expect(await screen.findByRole("heading", { name: "Nowa podkategoria" })).toBeInTheDocument();
    const trigger = await screen.findByRole("button", { name: /^Kategoria nadrzędna Kobiety › Ubrania/ });
    expect(trigger).toHaveAccessibleDescription("Puste = kategoria główna. Nie można zmienić po utworzeniu.");
    // Field order: parent, name, size class, description.
    const name = screen.getByLabelText("Nazwa");
    const sizeClass = screen.getByLabelText("Klasa wielkości (wycena punktowa)");
    const description = screen.getByLabelText("Opis (opcjonalnie)");
    expect(trigger.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(name.compareDocumentPosition(sizeClass) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sizeClass.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.change(name, { target: { value: "Sukienki koktajlowe" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    });

    await waitFor(() =>
      expect(categoriesApi.createCategory).toHaveBeenCalledWith({
        name: "Sukienki koktajlowe",
        description: undefined,
        parent_id: "c1",
        size_class: null,
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
      expect(categoriesApi.createCategory).toHaveBeenCalledWith({ name: "Dom", description: undefined, parent_id: null, size_class: null }),
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

    expect(categoriesApi.updateCategory).toHaveBeenCalledWith("l1", {
      name: "Sukienki",
      description: "Midi",
      size_class: null,
    });
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

describe("CategoryFormPage — size class", () => {
  function optionLabels(select: HTMLElement): string[] {
    return within(select)
      .getAllByRole("option")
      .map((option) => option.textContent ?? "");
  }

  it("names the inherited parent value and sends the chosen class", async () => {
    vi.mocked(categoriesApi.getCategory).mockResolvedValue(mockCategories[2]!);
    vi.mocked(categoriesApi.updateCategory).mockResolvedValue({ ...mockCategories[2]!, size_class: "SMALL" });
    renderAt("/admin/categories/l1/edit");

    await screen.findByDisplayValue("Sukienki");
    const select = screen.getByLabelText("Klasa wielkości (wycena punktowa)");
    await waitFor(() =>
      expect(optionLabels(select)).toEqual([
        "Dziedzicz z kategorii nadrzędnej (obecnie: Duża)",
        "Mała – baza 20 pkt",
        "Średnia – baza 40 pkt",
        "Duża – baza 60 pkt",
      ]),
    );
    expect(select).toHaveValue("");
    expect(select).toHaveAccessibleDescription(
      "Podkategorie bez ustawionej klasy dziedziczą tę wartość. Zmiana nie wpływa na ceny już wystawionych rzeczy.",
    );

    fireEvent.change(select, { target: { value: "SMALL" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    });

    await waitFor(() =>
      expect(categoriesApi.updateCategory).toHaveBeenCalledWith("l1", {
        name: "Sukienki",
        description: undefined,
        size_class: "SMALL",
      }),
    );
  });

  it("loads the own class and sends size_class null for Dziedzicz", async () => {
    vi.mocked(categoriesApi.getCategory).mockResolvedValue(mockCategories[1]!);
    vi.mocked(categoriesApi.updateCategory).mockResolvedValue({ ...mockCategories[1]!, size_class: null });
    renderAt("/admin/categories/c1/edit");

    await screen.findByDisplayValue("Ubrania");
    const select = screen.getByLabelText("Klasa wielkości (wycena punktowa)");
    expect(select).toHaveValue("LARGE");
    // The parent is a root without a class, so the inherited value is the default.
    expect(optionLabels(select)[0]).toBe("Dziedzicz z kategorii nadrzędnej (obecnie: Średnia)");

    fireEvent.change(select, { target: { value: "" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    });

    await waitFor(() =>
      expect(categoriesApi.updateCategory).toHaveBeenCalledWith("c1", {
        name: "Ubrania",
        description: undefined,
        size_class: null,
      }),
    );
  });

  it("offers the root default for a new root category", async () => {
    renderAt("/admin/categories/new");

    const select = await screen.findByLabelText("Klasa wielkości (wycena punktowa)");
    expect(optionLabels(select)[0]).toBe("Dziedzicz (domyślnie: Średnia)");
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
