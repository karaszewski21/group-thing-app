import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ItemQuickAddForm } from "../components/shared/ItemQuickAddForm";
import { createEmptyItemQuickAddValue } from "../utils/itemQuickAdd";
import { CONDITION_LABELS } from "../utils/productCategory";
import * as categoriesApi from "../api/categories";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
}));

function category(id: string, name: string, parent_id: string | null): categoriesApi.Category {
  return {
    id,
    name,
    description: null,
    parent_id,
    sort_order: 0,
    product_count: 0,
    created_at: "",
    updated_at: "",
  };
}

const mockCategories: categoriesApi.Category[] = [
  category("1", "Dzieci", null),
  category("2", "Zabawki", "1"),
];

/** Renders and lets the picker's category fetch settle inside act(). */
async function renderForm(props: Partial<Parameters<typeof ItemQuickAddForm>[0]> = {}) {
  render(<ItemQuickAddForm value={createEmptyItemQuickAddValue()} onChange={vi.fn()} {...props} />, {
    wrapper: createQueryWrapper(),
  });
  await act(async () => {});
}

function categoryTrigger() {
  return screen.getByRole("button", { name: /^Kategoria/ });
}

describe("ItemQuickAddForm", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
  });

  it("renders Nazwa, Stan and the Kategoria picker in order, without a Typ select", async () => {
    await renderForm();

    const name = screen.getByLabelText("Nazwa");
    const condition = screen.getByLabelText("Stan");
    const trigger = categoryTrigger();
    expect(name.compareDocumentPosition(condition) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(condition.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByLabelText("Typ")).not.toBeInTheDocument();
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });

  it("`Stan` select options match CONDITION_LABELS", async () => {
    await renderForm();
    const select = screen.getByLabelText("Stan") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(Object.values(CONDITION_LABELS));
  });

  it("emits the chosen leaf as category_id", async () => {
    const onChange = vi.fn();
    await renderForm({ value: { ...createEmptyItemQuickAddValue(), name: "Rowerek" }, onChange });

    categoryTrigger().focus();
    fireEvent.click(categoryTrigger());
    fireEvent.click(await screen.findByRole("button", { name: "Dzieci" }));
    fireEvent.click(screen.getByRole("button", { name: "Zabawki" }));

    expect(onChange).toHaveBeenCalledWith({ name: "Rowerek", condition: "GOOD", category_id: "2", description: "" });
  });

  it("disables every field when `disabled` is true", async () => {
    await renderForm({ disabled: true });
    expect(screen.getByLabelText("Nazwa")).toBeDisabled();
    expect(screen.getByLabelText("Stan")).toBeDisabled();
    expect(categoryTrigger()).toBeDisabled();
  });
});
