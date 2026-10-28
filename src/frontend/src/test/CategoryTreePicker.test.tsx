import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type FormEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as categoriesApi from "../api/categories";
import type { Category } from "../api/categories";
import { CategoryTreePicker, type CategoryPickerMode } from "../components/shared/CategoryTreePicker";
import { withQueryClient } from "./queryClient";

vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
  deleteCategory: vi.fn(),
  moveCategory: vi.fn(),
}));

function category(id: string, name: string, parent_id: string | null, sort_order = 0): Category {
  return {
    id,
    name,
    description: null,
    parent_id,
    sort_order,
    product_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

const CATEGORIES: Category[] = [
  category("women", "Kobiety", null, 0),
  category("clothes", "Ubrania", "women", 0),
  category("dresses", "Sukienki", "clothes", 0),
  category("midi", "Sukienki midi", "dresses", 0),
  category("mini", "Sukienki mini", "dresses", 1),
  category("other", "Inne ubrania", "clothes", 1),
  category("books", "Książki", null, 1),
  category("games", "Gry", null, 2),
  ...Array.from({ length: 60 }, (_, i) => category(`game-${i + 1}`, `Gra ${i + 1}`, "games", i)),
];

function Host({
  mode,
  initial = null,
  onChange,
  onSubmit,
}: {
  mode?: CategoryPickerMode;
  initial?: string | null;
  onChange?: (id: string | null) => void;
  onSubmit?: (event: FormEvent) => void;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <form onSubmit={onSubmit}>
      <span id="cat-label">Kategoria</span>
      <CategoryTreePicker
        labelledBy="cat-label"
        mode={mode}
        value={value}
        onChange={(id) => {
          onChange?.(id);
          setValue(id);
        }}
      />
    </form>
  );
}

function renderPicker(props: Parameters<typeof Host>[0] = {}) {
  return render(withQueryClient(<Host {...props} />));
}

function trigger() {
  return screen.getByRole("button", { name: /^Kategoria/ });
}

async function openSheet() {
  trigger().focus();
  fireEvent.click(trigger());
  return screen.findByRole("dialog", { name: "Wybierz kategorię" });
}

function search() {
  return screen.getByRole("combobox", { name: "Szukaj kategorii" });
}

function breadcrumb() {
  return screen.getByRole("navigation", { name: "Ścieżka" });
}

describe("CategoryTreePicker", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(CATEGORIES);
  });

  it("drills down, jumps through the breadcrumb and goes back", async () => {
    renderPicker();
    await openSheet();

    expect(screen.queryByRole("button", { name: "‹ Wstecz" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Kobiety" }));
    fireEvent.click(screen.getByRole("button", { name: "Ubrania" }));

    expect(screen.getByRole("button", { name: "Sukienki" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inne ubrania" })).toBeInTheDocument();
    const crumbs = within(breadcrumb());
    expect(crumbs.getByRole("button", { name: "Wszystkie" })).toBeInTheDocument();
    expect(crumbs.getByText("Ubrania").tagName).toBe("B");

    fireEvent.click(crumbs.getByRole("button", { name: "Kobiety" }));
    expect(screen.getByRole("button", { name: "Ubrania" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sukienki" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "‹ Wstecz" }));
    expect(screen.getByRole("button", { name: "Kobiety" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Książki" })).toBeInTheDocument();
  });

  it("searches without diacritics, shows paths and caps the list at 50", async () => {
    renderPicker();
    await openSheet();
    await screen.findByRole("button", { name: "Kobiety" });

    fireEvent.change(search(), { target: { value: "ksiazki" } });
    const book = screen.getByRole("option", { name: "Książki" });
    expect(within(book).getByText("Książki").tagName).toBe("MARK");
    expect(screen.getByText("1 wynik")).toHaveAttribute("aria-live", "polite");

    fireEvent.change(search(), { target: { value: "sukienki" } });
    expect(screen.getByRole("option", { name: "Kobiety › Ubrania › Sukienki" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Kobiety › Ubrania › Sukienki › Sukienki midi" })).toBeInTheDocument();
    expect(screen.getByText("3 wyniki")).toBeInTheDocument();

    fireEvent.change(search(), { target: { value: "gra" } });
    expect(screen.getAllByRole("option")).toHaveLength(50);
    expect(screen.getByText("Pokazano 50 z 60 — zawęź wyszukiwanie")).toBeInTheDocument();
  });

  it("drills into a non-leaf result in leaf mode and selects it in any mode", async () => {
    const onChange = vi.fn();
    const { unmount } = renderPicker({ onChange });
    await openSheet();
    await screen.findByRole("button", { name: "Kobiety" });

    fireEvent.change(search(), { target: { value: "sukienki" } });
    fireEvent.click(screen.getByRole("option", { name: "Kobiety › Ubrania › Sukienki" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(search()).toHaveValue("");
    expect(screen.getByRole("button", { name: "Sukienki midi" })).toBeInTheDocument();
    unmount();

    renderPicker({ mode: "any", onChange });
    await openSheet();
    await screen.findByRole("button", { name: "Kobiety" });
    fireEvent.change(search(), { target: { value: "sukienki" } });
    fireEvent.click(screen.getByRole("option", { name: "Kobiety › Ubrania › Sukienki" }));

    expect(onChange).toHaveBeenCalledWith("dresses");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger()).toHaveTextContent("Kobiety › Ubrania ›");
    expect(trigger()).toHaveTextContent("Sukienki");
  });

  it("selects the active option with ArrowDown and Enter", async () => {
    const onChange = vi.fn();
    renderPicker({ onChange });
    await openSheet();
    await screen.findByRole("button", { name: "Kobiety" });

    fireEvent.change(search(), { target: { value: "sukienki" } });
    expect(search()).toHaveAttribute("aria-expanded", "true");
    expect(search()).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    fireEvent.keyDown(search(), { key: "ArrowDown" });

    const midi = screen.getByRole("option", { name: "Kobiety › Ubrania › Sukienki › Sukienki midi" });
    expect(search()).toHaveAttribute("aria-activedescendant", midi.id);
    expect(midi).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(search(), { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("midi");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger()).toHaveTextContent("Kobiety › Ubrania › Sukienki ›");
    expect(within(trigger()).getByText("Sukienki midi").tagName).toBe("SPAN");
  });

  it("clears the search on Escape without closing the sheet", async () => {
    renderPicker();
    await openSheet();
    await screen.findByRole("button", { name: "Kobiety" });

    fireEvent.change(search(), { target: { value: "sukienki" } });
    fireEvent.keyDown(search(), { key: "Escape" });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(search()).toHaveValue("");
    expect(search()).not.toHaveAttribute("aria-controls");
    expect(screen.getByRole("button", { name: "Kobiety" })).toBeInTheDocument();

    fireEvent.keyDown(search(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("returns focus to the trigger after a selection and reopens at the parent level", async () => {
    const onChange = vi.fn();
    renderPicker({ onChange });
    await openSheet();

    fireEvent.click(await screen.findByRole("button", { name: "Kobiety" }));
    fireEvent.click(screen.getByRole("button", { name: "Ubrania" }));
    fireEvent.click(screen.getByRole("button", { name: "Inne ubrania" }));

    expect(onChange).toHaveBeenCalledWith("other");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();

    await openSheet();
    expect(screen.getByRole("button", { name: "Sukienki" })).toBeInTheDocument();
    expect(within(breadcrumb()).getByText("Ubrania").tagName).toBe("B");
  });

  it("never submits the host form from the trigger, the close button or Enter in the search", async () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    renderPicker({ onSubmit });

    const dialog = await openSheet();
    await screen.findByRole("button", { name: "Kobiety" });
    for (const button of within(dialog).getAllByRole("button")) {
      expect(button).toHaveAttribute("type", "button");
    }
    expect(trigger()).toHaveAttribute("type", "button");

    fireEvent.change(search(), { target: { value: "sukienki" } });
    expect(fireEvent.keyDown(search(), { key: "Enter" })).toBe(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Zamknij" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("closes on a scrim click without reopening or submitting", async () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    const onChange = vi.fn();
    renderPicker({ onSubmit, onChange, mode: "any", initial: "clothes" });

    const dialog = await openSheet();
    expect(await screen.findByRole("button", { name: "Wybierz „Kobiety”" })).toBeInTheDocument();
    expect(dialog.parentElement).not.toBeNull();
    fireEvent.click(dialog.parentElement as HTMLElement);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger()).toHaveTextContent("Ubrania");
  });
});
