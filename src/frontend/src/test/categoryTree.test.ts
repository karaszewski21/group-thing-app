import { describe, expect, it } from "vitest";
import type { Category } from "../api/categories";
import {
  buildCategoryIndex,
  categoryPathNames,
  formatCategoryPath,
  isLeaf,
  searchCategories,
} from "../utils/categoryTree";

function category(id: string, name: string, parent_id: string | null, sort_order: number): Category {
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

// Deliberately unsorted input: the index must order children by sort_order.
const categories: Category[] = [
  category("dzieci", "Dzieci", null, 1),
  category("kobiety", "Kobiety", null, 0),
  category("ubrania", "Ubrania", "kobiety", 1),
  category("buty", "Buty", "kobiety", 0),
  category("sukienki", "Sukienki", "ubrania", 0),
  category("midi", "Sukienki midi", "sukienki", 0),
  category("ksiazki", "Książki", "dzieci", 1),
  category("lozka", "Łóżeczka", "dzieci", 0),
];

const index = buildCategoryIndex(categories);

describe("categoryTree", () => {
  it.each<[string, () => void]>([
    [
      "the index sorts roots and children by sort_order",
      () => {
        expect(index.childrenOf(null).map((c) => c.id)).toEqual(["kobiety", "dzieci"]);
        expect(index.childrenOf("kobiety").map((c) => c.id)).toEqual(["buty", "ubrania"]);
        expect(index.byId.get("midi")?.name).toBe("Sukienki midi");
      },
    ],
    [
      "isLeaf is true only for nodes without children",
      () => {
        expect(isLeaf(index, "midi")).toBe(true);
        expect(isLeaf(index, "buty")).toBe(true);
        expect(isLeaf(index, "sukienki")).toBe(false);
        expect(isLeaf(index, "kobiety")).toBe(false);
      },
    ],
    [
      "formatCategoryPath joins root-to-node names with ' › '",
      () => {
        expect(categoryPathNames(index, "midi")).toEqual(["Kobiety", "Ubrania", "Sukienki", "Sukienki midi"]);
        expect(formatCategoryPath(index, "midi")).toBe("Kobiety › Ubrania › Sukienki › Sukienki midi");
        expect(formatCategoryPath(index, "kobiety")).toBe("Kobiety");
      },
    ],
    [
      "searchCategories folds case, diacritics and ł→l",
      () => {
        expect(searchCategories(index, "ksiazki").results.map((r) => r.category.id)).toEqual(["ksiazki"]);
        expect(searchCategories(index, "KSIĄŻ").results.map((r) => r.category.id)).toEqual(["ksiazki"]);
        expect(searchCategories(index, "lozecz").results.map((r) => r.category.id)).toEqual(["lozka"]);
        expect(searchCategories(index, "   ").results).toEqual([]);
      },
    ],
    [
      "searchCategories returns the ancestor path of each match and the total count",
      () => {
        const { results, total } = searchCategories(index, "sukienki");
        expect(total).toBe(2);
        expect(results.map((r) => [r.category.id, r.path])).toEqual([
          ["sukienki", ["Kobiety", "Ubrania"]],
          ["midi", ["Kobiety", "Ubrania", "Sukienki"]],
        ]);
      },
    ],
  ])("%s", (_name, check) => {
    check();
  });
});
