import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ItemQuickAddForm } from "../components/shared/ItemQuickAddForm";
import { createEmptyItemQuickAddValue } from "../utils/itemQuickAdd";
import * as categoriesApi from "../api/categories";
import type { Category } from "../api/categories";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
}));

const mockCategories: Category[] = [
  {
    id: "3",
    name: "Zabawki",
    description: null,
    parent_id: null,
    sort_order: 0,
    product_count: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

describe("ItemQuickAddForm — Kategoria picker", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
  });

  it("renders a required Kategoria picker labelled through aria-labelledby, outside any <label>", async () => {
    render(<ItemQuickAddForm value={createEmptyItemQuickAddValue()} onChange={vi.fn()} />, {
      wrapper: createQueryWrapper(),
    });
    await act(async () => {});

    const trigger = screen.getByRole("button", { name: /^Kategoria/ });
    const labelId = trigger.getAttribute("aria-labelledby")!.split(" ")[0];
    const label = document.getElementById(labelId)!;
    expect(label.tagName).toBe("SPAN");
    expect(label).toHaveTextContent("Kategoria *");
    expect(label.querySelector('[aria-hidden="true"]')).toHaveTextContent("*");
    expect(trigger).toHaveAttribute("type", "button");
    expect(trigger.closest("label")).toBeNull();
  });

  it("has no default category: the trigger shows the placeholder and the value is empty", async () => {
    expect(createEmptyItemQuickAddValue().category_id).toBe("");
    render(<ItemQuickAddForm value={createEmptyItemQuickAddValue()} onChange={vi.fn()} />, {
      wrapper: createQueryWrapper(),
    });

    await act(async () => {});
    expect(categoriesApi.getCategories).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Kategoria/ })).toHaveTextContent("Wybierz kategorię");
    expect(screen.queryByText("Zabawki")).not.toBeInTheDocument();
  });
});
